
    /*!
    * tiptap-extensions v1.33.2
    * (c) 2021 überdosis GbR (limited liability)
    * @license MIT
    */
  
import { Node, Plugin, PluginKey, Mark, Extension } from 'tiptap';
import { toggleWrap, wrappingInputRule, toggleList, toggleBlockType, setBlockType, textblockTypeInputRule, chainCommands, exitCode, nodeInputRule, splitListItem, sinkListItem, liftListItem, insertText, replaceText, splitToDefaultListItem, toggleMark, markInputRule, markPasteRule, updateMark, removeMark, pasteRule } from 'tiptap-commands';
import low from 'lowlight/lib/core';
import { DecorationSet, Decoration } from 'prosemirror-view';
import { findBlockNodes, createTable } from 'prosemirror-utils';
import { Fragment } from 'prosemirror-model';
import { Plugin as Plugin$1, PluginKey as PluginKey$1, TextSelection } from 'prosemirror-state';
import { tableNodes, addColumnBefore, addColumnAfter, deleteColumn, addRowBefore, addRowAfter, deleteRow, deleteTable, mergeCells, splitCell, toggleHeaderColumn, toggleHeaderRow, toggleHeaderCell, setCellAttr, fixTables, goToNextCell, columnResizing, tableEditing } from 'prosemirror-tables';
import { getMarkAttrs, nodeEqualsType } from 'tiptap-utils';
import { Step } from 'prosemirror-transform';
import { sendableSteps, getVersion, receiveTransaction, collab } from 'prosemirror-collab';
import { history, undo, redo, undoDepth, redoDepth } from 'prosemirror-history';

class Blockquote extends Node {
  get name() {
    return 'blockquote';
  }

  get schema() {
    return {
      content: 'block*',
      group: 'block',
      defining: true,
      draggable: false,
      parseDOM: [{
        tag: 'blockquote'
      }],
      toDOM: () => ['blockquote', 0]
    };
  }

  commands({
    type
  }) {
    return () => toggleWrap(type);
  }

  keys({
    type
  }) {
    return {
      'Ctrl->': toggleWrap(type)
    };
  }

  inputRules({
    type
  }) {
    return [wrappingInputRule(/^\s*>\s$/, type)];
  }

}

class BulletList extends Node {
  get name() {
    return 'bullet_list';
  }

  get schema() {
    return {
      content: 'list_item+',
      group: 'block',
      parseDOM: [{
        tag: 'ul'
      }],
      toDOM: () => ['ul', 0]
    };
  }

  commands({
    type,
    schema
  }) {
    return () => toggleList(type, schema.nodes.list_item);
  }

  keys({
    type,
    schema
  }) {
    return {
      'Shift-Ctrl-8': toggleList(type, schema.nodes.list_item)
    };
  }

  inputRules({
    type
  }) {
    return [wrappingInputRule(/^\s*([-+*])\s$/, type)];
  }

}

class CodeBlock extends Node {
  get name() {
    return 'code_block';
  }

  get schema() {
    return {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      draggable: false,
      parseDOM: [{
        tag: 'pre',
        preserveWhitespace: 'full'
      }],
      toDOM: () => ['pre', ['code', 0]]
    };
  }

  commands({
    type,
    schema
  }) {
    return () => toggleBlockType(type, schema.nodes.paragraph);
  }

  keys({
    type
  }) {
    return {
      'Shift-Ctrl-\\': setBlockType(type)
    };
  }

  inputRules({
    type
  }) {
    return [textblockTypeInputRule(/^```$/, type)];
  }

}

function getDecorations({
  doc,
  name
}) {
  const decorations = [];
  const blocks = findBlockNodes(doc).filter(item => item.node.type.name === name);

  const flatten = list => list.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);

  function parseNodes(nodes, className = []) {
    return nodes.map(node => {
      const classes = [...className, ...(node.properties ? node.properties.className : [])];

      if (node.children) {
        return parseNodes(node.children, classes);
      }

      return {
        text: node.value,
        classes
      };
    });
  }

  blocks.forEach(block => {
    let startPos = block.pos + 1;
    const nodes = low.highlightAuto(block.node.textContent).value;
    flatten(parseNodes(nodes)).map(node => {
      const from = startPos;
      const to = from + node.text.length;
      startPos = to;
      return { ...node,
        from,
        to
      };
    }).forEach(node => {
      const decoration = Decoration.inline(node.from, node.to, {
        class: node.classes.join(' ')
      });
      decorations.push(decoration);
    });
  });
  return DecorationSet.create(doc, decorations);
}

function HighlightPlugin({
  name
}) {
  return new Plugin({
    name: new PluginKey('highlight'),
    state: {
      init: (_, {
        doc
      }) => getDecorations({
        doc,
        name
      }),
      apply: (transaction, decorationSet, oldState, newState) => {
        // TODO: find way to cache decorations
        // https://discuss.prosemirror.net/t/how-to-update-multiple-inline-decorations-on-node-change/1493
        const oldNodeName = oldState.selection.$head.parent.type.name;
        const newNodeName = newState.selection.$head.parent.type.name;
        const oldNodes = findBlockNodes(oldState.doc).filter(item => item.node.type.name === name);
        const newNodes = findBlockNodes(newState.doc).filter(item => item.node.type.name === name); // Apply decorations if selection includes named node, or transaction changes named node.

        if (transaction.docChanged && ([oldNodeName, newNodeName].includes(name) || newNodes.length !== oldNodes.length)) {
          return getDecorations({
            doc: transaction.doc,
            name
          });
        }

        return decorationSet.map(transaction.mapping, transaction.doc);
      }
    },
    props: {
      decorations(state) {
        return this.getState(state);
      }

    }
  });
}

class CodeBlockHighlight extends Node {
  constructor(options = {}) {
    super(options);

    try {
      Object.entries(this.options.languages).forEach(([name, mapping]) => {
        low.registerLanguage(name, mapping);
      });
    } catch (err) {
      throw new Error('Invalid syntax highlight definitions: define at least one highlight.js language mapping');
    }
  }

  get name() {
    return 'code_block';
  }

  get defaultOptions() {
    return {
      languages: {}
    };
  }

  get schema() {
    return {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      draggable: false,
      parseDOM: [{
        tag: 'pre',
        preserveWhitespace: 'full'
      }],
      toDOM: () => ['pre', ['code', 0]]
    };
  }

  commands({
    type,
    schema
  }) {
    return () => toggleBlockType(type, schema.nodes.paragraph);
  }

  keys({
    type
  }) {
    return {
      'Shift-Ctrl-\\': setBlockType(type)
    };
  }

  inputRules({
    type
  }) {
    return [textblockTypeInputRule(/^```$/, type)];
  }

  get plugins() {
    return [HighlightPlugin({
      name: this.name
    })];
  }

}

class HardBreak extends Node {
  get name() {
    return 'hard_break';
  }

  get schema() {
    return {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{
        tag: 'br'
      }],
      toDOM: () => ['br']
    };
  }

  commands({
    type
  }) {
    return () => chainCommands(exitCode, (state, dispatch) => {
      dispatch(state.tr.replaceSelectionWith(type.create()).scrollIntoView());
      return true;
    });
  }

  keys({
    type
  }) {
    const command = chainCommands(exitCode, (state, dispatch) => {
      dispatch(state.tr.replaceSelectionWith(type.create()).scrollIntoView());
      return true;
    });
    return {
      'Mod-Enter': command,
      'Shift-Enter': command
    };
  }

}

class Heading extends Node {
  get name() {
    return 'heading';
  }

  get defaultOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6]
    };
  }

  get schema() {
    return {
      attrs: {
        level: {
          default: 1
        }
      },
      content: 'inline*',
      group: 'block',
      defining: true,
      draggable: false,
      parseDOM: this.options.levels.map(level => ({
        tag: "h".concat(level),
        attrs: {
          level
        }
      })),
      toDOM: node => ["h".concat(node.attrs.level), 0]
    };
  }

  commands({
    type,
    schema
  }) {
    return attrs => toggleBlockType(type, schema.nodes.paragraph, attrs);
  }

  keys({
    type
  }) {
    return this.options.levels.reduce((items, level) => ({ ...items,
      ...{
        ["Shift-Ctrl-".concat(level)]: setBlockType(type, {
          level
        })
      }
    }), {});
  }

  inputRules({
    type
  }) {
    return this.options.levels.map(level => textblockTypeInputRule(new RegExp("^(#{1,".concat(level, "})\\s$")), type, () => ({
      level
    })));
  }

}

class HorizontalRule extends Node {
  get name() {
    return 'horizontal_rule';
  }

  get schema() {
    return {
      group: 'block',
      parseDOM: [{
        tag: 'hr'
      }],
      toDOM: () => ['hr']
    };
  }

  commands({
    type
  }) {
    return () => (state, dispatch) => dispatch(state.tr.replaceSelectionWith(type.create()));
  }

  inputRules({
    type
  }) {
    return [nodeInputRule(/^(?:---|___\s|\*\*\*\s)$/, type)];
  }

}

/**
 * Matches following attributes in Markdown-typed image: [, alt, src, title]
 *
 * Example:
 * ![Lorem](image.jpg) -> [, "Lorem", "image.jpg"]
 * ![](image.jpg "Ipsum") -> [, "", "image.jpg", "Ipsum"]
 * ![Lorem](image.jpg "Ipsum") -> [, "Lorem", "image.jpg", "Ipsum"]
 */

const IMAGE_INPUT_REGEX = /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/;
class Image extends Node {
  get name() {
    return 'image';
  }

  get schema() {
    return {
      inline: true,
      attrs: {
        src: {},
        alt: {
          default: null
        },
        title: {
          default: null
        }
      },
      group: 'inline',
      draggable: true,
      parseDOM: [{
        tag: 'img[src]',
        getAttrs: dom => ({
          src: dom.getAttribute('src'),
          title: dom.getAttribute('title'),
          alt: dom.getAttribute('alt')
        })
      }],
      toDOM: node => ['img', node.attrs]
    };
  }

  commands({
    type
  }) {
    return attrs => (state, dispatch) => {
      const {
        selection
      } = state;
      const position = selection.$cursor ? selection.$cursor.pos : selection.$to.pos;
      const node = type.create(attrs);
      const transaction = state.tr.insert(position, node);
      dispatch(transaction);
    };
  }

  inputRules({
    type
  }) {
    return [nodeInputRule(IMAGE_INPUT_REGEX, type, match => {
      const [, alt, src, title] = match;
      return {
        src,
        alt,
        title
      };
    })];
  }

  get plugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          drop(view, event) {
            const hasFiles = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length;

            if (!hasFiles) {
              return;
            }

            const images = Array.from(event.dataTransfer.files).filter(file => /image/i.test(file.type));

            if (images.length === 0) {
              return;
            }

            event.preventDefault();
            const {
              schema
            } = view.state;
            const coordinates = view.posAtCoords({
              left: event.clientX,
              top: event.clientY
            });
            images.forEach(image => {
              const reader = new FileReader();

              reader.onload = readerEvent => {
                const node = schema.nodes.image.create({
                  src: readerEvent.target.result
                });
                const transaction = view.state.tr.insert(coordinates.pos, node);
                view.dispatch(transaction);
              };

              reader.readAsDataURL(image);
            });
          }

        }
      }
    })];
  }

}

class ListItem extends Node {
  get name() {
    return 'list_item';
  }

  get schema() {
    return {
      content: 'paragraph block*',
      defining: true,
      draggable: false,
      parseDOM: [{
        tag: 'li'
      }],
      toDOM: () => ['li', 0]
    };
  }

  keys({
    type
  }) {
    return {
      Enter: splitListItem(type),
      Tab: sinkListItem(type),
      'Shift-Tab': liftListItem(type)
    };
  }

}

function triggerCharacter({
  char = '@',
  allowSpaces = false,
  startOfLine = false
}) {
  return $position => {
    // cancel if top level node
    if ($position.depth <= 0) {
      return false;
    } // Matching expressions used for later


    const escapedChar = "\\".concat(char);
    const suffix = new RegExp("\\s".concat(escapedChar, "$"));
    const prefix = startOfLine ? '^' : '';
    const regexp = allowSpaces ? new RegExp("".concat(prefix).concat(escapedChar, ".*?(?=\\s").concat(escapedChar, "|$)"), 'gm') : new RegExp("".concat(prefix, "(?:^)?").concat(escapedChar, "[^\\s").concat(escapedChar, "]*"), 'gm'); // Lookup the boundaries of the current node

    const textFrom = $position.before();
    const textTo = $position.end();
    const text = $position.doc.textBetween(textFrom, textTo, '\0', '\0');
    let match = regexp.exec(text);
    let position;

    while (match !== null) {
      // JavaScript doesn't have lookbehinds; this hacks a check that first character is " "
      // or the line beginning
      const matchPrefix = match.input.slice(Math.max(0, match.index - 1), match.index);

      if (/^[\s\0]?$/.test(matchPrefix)) {
        // The absolute position of the match in the document
        const from = match.index + $position.start();
        let to = from + match[0].length; // Edge case handling; if spaces are allowed and we're directly in between
        // two triggers

        if (allowSpaces && suffix.test(text.slice(to - 1, to + 1))) {
          match[0] += ' ';
          to += 1;
        } // If the $position is located within the matched substring, return that range


        if (from < $position.pos && to >= $position.pos) {
          position = {
            range: {
              from,
              to
            },
            query: match[0].slice(char.length),
            text: match[0]
          };
        }
      }

      match = regexp.exec(text);
    }

    return position;
  };
}

function SuggestionsPlugin({
  matcher = {
    char: '@',
    allowSpaces: false,
    startOfLine: false
  },
  appendText = null,
  suggestionClass = 'suggestion',
  command = () => false,
  items = [],
  onEnter = () => false,
  onChange = () => false,
  onExit = () => false,
  onKeyDown = () => false,
  onFilter = (searchItems, query) => {
    if (!query) {
      return searchItems;
    }

    return searchItems.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  }
}) {
  return new Plugin$1({
    key: new PluginKey$1('suggestions'),

    view() {
      return {
        update: async (view, prevState) => {
          const prev = this.key.getState(prevState);
          const next = this.key.getState(view.state); // See how the state changed

          const moved = prev.active && next.active && prev.range.from !== next.range.from;
          const started = !prev.active && next.active;
          const stopped = prev.active && !next.active;
          const changed = !started && !stopped && prev.query !== next.query;
          const handleStart = started || moved;
          const handleChange = changed && !moved;
          const handleExit = stopped || moved; // Cancel when suggestion isn't active

          if (!handleStart && !handleChange && !handleExit) {
            return;
          }

          const state = handleExit ? prev : next;
          const decorationNode = document.querySelector("[data-decoration-id=\"".concat(state.decorationId, "\"]")); // build a virtual node for popper.js or tippy.js
          // this can be used for building popups without a DOM node

          const virtualNode = decorationNode ? {
            getBoundingClientRect() {
              return decorationNode.getBoundingClientRect();
            },

            clientWidth: decorationNode.clientWidth,
            clientHeight: decorationNode.clientHeight
          } : null;
          const props = {
            view,
            range: state.range,
            query: state.query,
            text: state.text,
            decorationNode,
            virtualNode,
            items: handleChange || handleStart ? await onFilter(Array.isArray(items) ? items : await items(), state.query) : [],
            command: ({
              range,
              attrs
            }) => {
              command({
                range,
                attrs,
                schema: view.state.schema
              })(view.state, view.dispatch, view);

              if (appendText) {
                insertText(appendText)(view.state, view.dispatch, view);
              }
            }
          }; // Trigger the hooks when necessary

          if (handleExit) {
            onExit(props);
          }

          if (handleChange) {
            onChange(props);
          }

          if (handleStart) {
            onEnter(props);
          }
        }
      };
    },

    state: {
      // Initialize the plugin's internal state.
      init() {
        return {
          active: false,
          range: {},
          query: null,
          text: null
        };
      },

      // Apply changes to the plugin state from a view transaction.
      apply(tr, prev) {
        const {
          selection
        } = tr;
        const next = { ...prev
        }; // We can only be suggesting if there is no selection

        if (selection.from === selection.to) {
          // Reset active state if we just left the previous suggestion range
          if (selection.from < prev.range.from || selection.from > prev.range.to) {
            next.active = false;
          } // Try to match against where our cursor currently is


          const $position = selection.$from;
          const match = triggerCharacter(matcher)($position);
          const decorationId = (Math.random() + 1).toString(36).substr(2, 5); // If we found a match, update the current state to show it

          if (match) {
            next.active = true;
            next.decorationId = prev.decorationId ? prev.decorationId : decorationId;
            next.range = match.range;
            next.query = match.query;
            next.text = match.text;
          } else {
            next.active = false;
          }
        } else {
          next.active = false;
        } // Make sure to empty the range if suggestion is inactive


        if (!next.active) {
          next.decorationId = null;
          next.range = {};
          next.query = null;
          next.text = null;
        }

        return next;
      }

    },
    props: {
      // Call the keydown hook if suggestion is active.
      handleKeyDown(view, event) {
        const {
          active,
          range
        } = this.getState(view.state);
        if (!active) return false;
        return onKeyDown({
          view,
          event,
          range
        });
      },

      // Setup decorator on the currently active suggestion.
      decorations(editorState) {
        const {
          active,
          range,
          decorationId
        } = this.getState(editorState);
        if (!active) return null;
        return DecorationSet.create(editorState.doc, [Decoration.inline(range.from, range.to, {
          nodeName: 'span',
          class: suggestionClass,
          'data-decoration-id': decorationId
        })]);
      }

    }
  });
}

class Mention extends Node {
  get name() {
    return 'mention';
  }

  get defaultOptions() {
    return {
      matcher: {
        char: '@',
        allowSpaces: false,
        startOfLine: false
      },
      mentionClass: 'mention',
      suggestionClass: 'mention-suggestion'
    };
  }

  getLabel(dom) {
    return dom.innerText.split(this.options.matcher.char).join('');
  }

  get schema() {
    return {
      attrs: {
        id: {},
        label: {}
      },
      group: 'inline',
      inline: true,
      content: 'inline*',
      selectable: false,
      atom: true,
      toDOM: node => ['span', {
        class: this.options.mentionClass,
        'data-mention-id': node.attrs.id
      }, "".concat(this.options.matcher.char).concat(node.attrs.label)],
      parseDOM: [{
        tag: 'span[data-mention-id]',
        getAttrs: dom => {
          const id = dom.getAttribute('data-mention-id');
          const label = this.getLabel(dom);
          return {
            id,
            label
          };
        },
        getContent: (dom, schema) => {
          const label = this.getLabel(dom);
          return Fragment.fromJSON(schema, [{
            type: 'text',
            text: "".concat(this.options.matcher.char).concat(label)
          }]);
        }
      }]
    };
  }

  commands({
    schema
  }) {
    return attrs => replaceText(null, schema.nodes[this.name], attrs);
  }

  get plugins() {
    return [SuggestionsPlugin({
      command: ({
        range,
        attrs,
        schema
      }) => replaceText(range, schema.nodes[this.name], attrs),
      appendText: ' ',
      matcher: this.options.matcher,
      items: this.options.items,
      onEnter: this.options.onEnter,
      onChange: this.options.onChange,
      onExit: this.options.onExit,
      onKeyDown: this.options.onKeyDown,
      onFilter: this.options.onFilter,
      suggestionClass: this.options.suggestionClass
    })];
  }

}

class OrderedList extends Node {
  get name() {
    return 'ordered_list';
  }

  get schema() {
    return {
      attrs: {
        order: {
          default: 1
        }
      },
      content: 'list_item+',
      group: 'block',
      parseDOM: [{
        tag: 'ol',
        getAttrs: dom => ({
          order: dom.hasAttribute('start') ? +dom.getAttribute('start') : 1
        })
      }],
      toDOM: node => node.attrs.order === 1 ? ['ol', 0] : ['ol', {
        start: node.attrs.order
      }, 0]
    };
  }

  commands({
    type,
    schema
  }) {
    return () => toggleList(type, schema.nodes.list_item);
  }

  keys({
    type,
    schema
  }) {
    return {
      'Shift-Ctrl-9': toggleList(type, schema.nodes.list_item)
    };
  }

  inputRules({
    type
  }) {
    return [wrappingInputRule(/^(\d+)\.\s$/, type, match => ({
      order: +match[1]
    }), (match, node) => node.childCount + node.attrs.order === +match[1])];
  }

}

var TableNodes = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+',
  cellAttributes: {
    background: {
      default: null,

      getFromDOM(dom) {
        return dom.style.backgroundColor || null;
      },

      setDOMAttr(value, attrs) {
        if (value) {
          const style = {
            style: "".concat(attrs.style || '', "background-color: ").concat(value, ";")
          };
          Object.assign(attrs, style);
        }
      }

    }
  }
});

class Table extends Node {
  get name() {
    return 'table';
  }

  get defaultOptions() {
    return {
      resizable: false
    };
  }

  get schema() {
    return TableNodes.table;
  }

  commands({
    schema
  }) {
    return {
      createTable: ({
        rowsCount,
        colsCount,
        withHeaderRow
      }) => (state, dispatch) => {
        const offset = state.tr.selection.anchor + 1;
        const nodes = createTable(schema, rowsCount, colsCount, withHeaderRow);
        const tr = state.tr.replaceSelectionWith(nodes).scrollIntoView();
        const resolvedPos = tr.doc.resolve(offset);
        tr.setSelection(TextSelection.near(resolvedPos));
        dispatch(tr);
      },
      addColumnBefore: () => addColumnBefore,
      addColumnAfter: () => addColumnAfter,
      deleteColumn: () => deleteColumn,
      addRowBefore: () => addRowBefore,
      addRowAfter: () => addRowAfter,
      deleteRow: () => deleteRow,
      deleteTable: () => deleteTable,
      toggleCellMerge: () => (state, dispatch) => {
        if (mergeCells(state, dispatch)) {
          return;
        }

        splitCell(state, dispatch);
      },
      mergeCells: () => mergeCells,
      splitCell: () => splitCell,
      toggleHeaderColumn: () => toggleHeaderColumn,
      toggleHeaderRow: () => toggleHeaderRow,
      toggleHeaderCell: () => toggleHeaderCell,
      setCellAttr: () => setCellAttr,
      fixTables: () => fixTables
    };
  }

  keys() {
    return {
      Tab: goToNextCell(1),
      'Shift-Tab': goToNextCell(-1)
    };
  }

  get plugins() {
    return [...(this.options.resizable ? [columnResizing()] : []), tableEditing()];
  }

}

class TableHeader extends Node {
  get name() {
    return 'table_header';
  }

  get schema() {
    return TableNodes.table_header;
  }

}

class TableCell extends Node {
  get name() {
    return 'table_cell';
  }

  get schema() {
    return TableNodes.table_cell;
  }

}

class TableRow extends Node {
  get name() {
    return 'table_row';
  }

  get schema() {
    return TableNodes.table_row;
  }

}

class TodoItem extends Node {
  get name() {
    return 'todo_item';
  }

  get defaultOptions() {
    return {
      nested: false
    };
  }

  get view() {
    return {
      props: ['node', 'updateAttrs', 'view'],
      methods: {
        onChange() {
          this.updateAttrs({
            done: !this.node.attrs.done
          });
        }

      },
      template: "\n        <li :data-type=\"node.type.name\" :data-done=\"node.attrs.done.toString()\" data-drag-handle>\n          <span class=\"todo-checkbox\" contenteditable=\"false\" @click=\"onChange\"></span>\n          <div class=\"todo-content\" ref=\"content\" :contenteditable=\"view.editable.toString()\"></div>\n        </li>\n      "
    };
  }

  get schema() {
    return {
      attrs: {
        done: {
          default: false
        }
      },
      draggable: true,
      content: this.options.nested ? '(paragraph|todo_list)+' : 'paragraph+',
      toDOM: node => {
        const {
          done
        } = node.attrs;
        return ['li', {
          'data-type': this.name,
          'data-done': done.toString()
        }, ['span', {
          class: 'todo-checkbox',
          contenteditable: 'false'
        }], ['div', {
          class: 'todo-content'
        }, 0]];
      },
      parseDOM: [{
        priority: 51,
        tag: "[data-type=\"".concat(this.name, "\"]"),
        getAttrs: dom => ({
          done: dom.getAttribute('data-done') === 'true'
        })
      }]
    };
  }

  keys({
    type
  }) {
    return {
      Enter: splitToDefaultListItem(type),
      Tab: this.options.nested ? sinkListItem(type) : () => {},
      'Shift-Tab': liftListItem(type)
    };
  }

}

class TodoList extends Node {
  get name() {
    return 'todo_list';
  }

  get schema() {
    return {
      group: 'block',
      content: 'todo_item+',
      toDOM: () => ['ul', {
        'data-type': this.name
      }, 0],
      parseDOM: [{
        priority: 51,
        tag: "[data-type=\"".concat(this.name, "\"]")
      }]
    };
  }

  commands({
    type,
    schema
  }) {
    return () => toggleList(type, schema.nodes.todo_item);
  }

  inputRules({
    type
  }) {
    return [wrappingInputRule(/^\s*(\[ \])\s$/, type)];
  }

}

class Bold extends Mark {
  get name() {
    return 'bold';
  }

  get schema() {
    return {
      parseDOM: [{
        tag: 'strong'
      }, {
        tag: 'b',
        getAttrs: node => node.style.fontWeight !== 'normal' && null
      }, {
        style: 'font-weight',
        getAttrs: value => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null
      }],
      toDOM: () => ['strong', 0]
    };
  }

  keys({
    type
  }) {
    return {
      'Mod-b': toggleMark(type)
    };
  }

  commands({
    type
  }) {
    return () => toggleMark(type);
  }

  inputRules({
    type
  }) {
    return [markInputRule(/(?:\*\*|__)([^*_]+)(?:\*\*|__)$/, type)];
  }

  pasteRules({
    type
  }) {
    return [markPasteRule(/(?:\*\*|__)([^*_]+)(?:\*\*|__)/g, type)];
  }

}

class Code extends Mark {
  get name() {
    return 'code';
  }

  get schema() {
    return {
      excludes: '_',
      parseDOM: [{
        tag: 'code'
      }],
      toDOM: () => ['code', 0]
    };
  }

  keys({
    type
  }) {
    return {
      'Mod-`': toggleMark(type)
    };
  }

  commands({
    type
  }) {
    return () => toggleMark(type);
  }

  inputRules({
    type
  }) {
    return [markInputRule(/(?:`)([^`]+)(?:`)$/, type)];
  }

  pasteRules({
    type
  }) {
    return [markPasteRule(/(?:`)([^`]+)(?:`)/g, type)];
  }

}

class Italic extends Mark {
  get name() {
    return 'italic';
  }

  get schema() {
    return {
      parseDOM: [{
        tag: 'i'
      }, {
        tag: 'em'
      }, {
        style: 'font-style=italic'
      }],
      toDOM: () => ['em', 0]
    };
  }

  keys({
    type
  }) {
    return {
      'Mod-i': toggleMark(type)
    };
  }

  commands({
    type
  }) {
    return () => toggleMark(type);
  }

  inputRules({
    type
  }) {
    return [markInputRule(/(?:^|[^_])(_([^_]+)_)$/, type), markInputRule(/(?:^|[^*])(\*([^*]+)\*)$/, type)];
  }

  pasteRules({
    type
  }) {
    return [markPasteRule(/_([^_]+)_/g, type), markPasteRule(/\*([^*]+)\*/g, type)];
  }

}

class Link extends Mark {
  get name() {
    return 'link';
  }

  get defaultOptions() {
    return {
      openOnClick: true,
      target: null
    };
  }

  get schema() {
    return {
      attrs: {
        href: {
          default: null
        },
        target: {
          default: null
        }
      },
      inclusive: false,
      parseDOM: [{
        tag: 'a[href]',
        getAttrs: dom => ({
          href: dom.getAttribute('href'),
          target: dom.getAttribute('target')
        })
      }],
      toDOM: node => ['a', { ...node.attrs,
        rel: 'noopener noreferrer nofollow',
        target: this.options.target
      }, 0]
    };
  }

  commands({
    type
  }) {
    return attrs => {
      if (attrs.href) {
        return updateMark(type, attrs);
      }

      return removeMark(type);
    };
  }

  pasteRules({
    type
  }) {
    return [pasteRule(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z]{2,}\b([-a-zA-Z0-9@:%_+.~#?&//=,]*)/gi, type, url => ({
      href: url
    }))];
  }

  get plugins() {
    if (!this.options.openOnClick) {
      return [];
    }

    return [new Plugin({
      props: {
        handleClick: (view, pos, event) => {
          const {
            schema
          } = view.state;
          const attrs = getMarkAttrs(view.state, schema.marks.link);

          if (attrs.href && event.target instanceof HTMLAnchorElement) {
            event.stopPropagation();
            window.open(attrs.href, attrs.target);
          }
        }
      }
    })];
  }

}

class Strike extends Mark {
  get name() {
    return 'strike';
  }

  get schema() {
    return {
      parseDOM: [{
        tag: 's'
      }, {
        tag: 'del'
      }, {
        tag: 'strike'
      }, {
        style: 'text-decoration',
        getAttrs: value => value === 'line-through'
      }],
      toDOM: () => ['s', 0]
    };
  }

  keys({
    type
  }) {
    return {
      'Mod-d': toggleMark(type)
    };
  }

  commands({
    type
  }) {
    return () => toggleMark(type);
  }

  inputRules({
    type
  }) {
    return [markInputRule(/~([^~]+)~$/, type)];
  }

  pasteRules({
    type
  }) {
    return [markPasteRule(/~([^~]+)~/g, type)];
  }

}

class Underline extends Mark {
  get name() {
    return 'underline';
  }

  get schema() {
    return {
      parseDOM: [{
        tag: 'u'
      }, {
        style: 'text-decoration',
        getAttrs: value => value === 'underline'
      }],
      toDOM: () => ['u', 0]
    };
  }

  keys({
    type
  }) {
    return {
      'Mod-u': toggleMark(type)
    };
  }

  commands({
    type
  }) {
    return () => toggleMark(type);
  }

}

class Collaboration extends Extension {
  get name() {
    return 'collaboration';
  }

  init() {
    this.getSendableSteps = this.debounce(state => {
      const sendable = sendableSteps(state);

      if (sendable) {
        this.options.onSendable({
          editor: this.editor,
          sendable: {
            version: sendable.version,
            steps: sendable.steps.map(step => step.toJSON()),
            clientID: sendable.clientID
          }
        });
      }
    }, this.options.debounce);
    this.editor.on('transaction', ({
      state
    }) => {
      this.getSendableSteps(state);
    });
  }

  get defaultOptions() {
    return {
      version: 0,
      clientID: Math.floor(Math.random() * 0xFFFFFFFF),
      debounce: 250,
      onSendable: () => {},
      update: ({
        steps,
        version
      }) => {
        const {
          state,
          view,
          schema
        } = this.editor;

        if (getVersion(state) > version) {
          return;
        }

        view.dispatch(receiveTransaction(state, steps.map(item => Step.fromJSON(schema, item.step)), steps.map(item => item.clientID)));
      }
    };
  }

  get plugins() {
    return [collab({
      version: this.options.version,
      clientID: this.options.clientID
    })];
  }

  debounce(fn, delay) {
    let timeout;
    return function (...args) {
      if (timeout) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(() => {
        fn(...args);
        timeout = null;
      }, delay);
    };
  }

}

class Focus extends Extension {
  get name() {
    return 'focus';
  }

  get defaultOptions() {
    return {
      className: 'has-focus',
      nested: false
    };
  }

  get plugins() {
    return [new Plugin({
      props: {
        decorations: ({
          doc,
          plugins,
          selection
        }) => {
          const editablePlugin = plugins.find(plugin => plugin.key.startsWith('editable$'));
          const editable = editablePlugin.props.editable();
          const active = editable && this.options.className;
          const {
            focused
          } = this.editor;
          const {
            anchor
          } = selection;
          const decorations = [];

          if (!active || !focused) {
            return false;
          }

          doc.descendants((node, pos) => {
            const hasAnchor = anchor >= pos && anchor <= pos + node.nodeSize;

            if (hasAnchor && !node.isText) {
              const decoration = Decoration.node(pos, pos + node.nodeSize, {
                class: this.options.className
              });
              decorations.push(decoration);
            }

            return this.options.nested;
          });
          return DecorationSet.create(doc, decorations);
        }
      }
    })];
  }

}

class History extends Extension {
  get name() {
    return 'history';
  }

  get defaultOptions() {
    return {
      depth: '',
      newGroupDelay: ''
    };
  }

  keys() {
    const keymap = {
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      // Russian language
      'Mod-я': undo,
      'Shift-Mod-я': redo
    };
    return keymap;
  }

  get plugins() {
    return [history({
      depth: this.options.depth,
      newGroupDelay: this.options.newGroupDelay
    })];
  }

  commands() {
    return {
      undo: () => undo,
      redo: () => redo,
      undoDepth: () => undoDepth,
      redoDepth: () => redoDepth
    };
  }

}

class Placeholder extends Extension {
  get name() {
    return 'placeholder';
  }

  get defaultOptions() {
    return {
      emptyEditorClass: 'is-editor-empty',
      emptyNodeClass: 'is-empty',
      emptyNodeText: 'Write something …',
      showOnlyWhenEditable: true,
      showOnlyCurrent: true
    };
  }

  get plugins() {
    return [new Plugin({
      props: {
        decorations: ({
          doc,
          plugins,
          selection
        }) => {
          const editablePlugin = plugins.find(plugin => plugin.key.startsWith('editable$'));
          const editable = editablePlugin.props.editable();
          const active = editable || !this.options.showOnlyWhenEditable;
          const {
            anchor
          } = selection;
          const decorations = [];
          const isEditorEmpty = doc.textContent.length === 0;

          if (!active) {
            return false;
          }

          doc.descendants((node, pos) => {
            const hasAnchor = anchor >= pos && anchor <= pos + node.nodeSize;
            const isNodeEmpty = node.content.size === 0;

            if ((hasAnchor || !this.options.showOnlyCurrent) && isNodeEmpty) {
              const classes = [this.options.emptyNodeClass];

              if (isEditorEmpty) {
                classes.push(this.options.emptyEditorClass);
              }

              const decoration = Decoration.node(pos, pos + node.nodeSize, {
                class: classes.join(' '),
                'data-empty-text': typeof this.options.emptyNodeText === 'function' ? this.options.emptyNodeText(node) : this.options.emptyNodeText
              });
              decorations.push(decoration);
            }

            return false;
          });
          return DecorationSet.create(doc, decorations);
        }
      }
    })];
  }

}

class Search extends Extension {
  constructor(options = {}) {
    super(options);
    this.results = [];
    this.searchTerm = null;
    this._updating = false;
  }

  get name() {
    return 'search';
  }

  get defaultOptions() {
    return {
      autoSelectNext: true,
      findClass: 'find',
      searching: false,
      caseSensitive: false,
      disableRegex: true,
      alwaysSearch: false
    };
  }

  commands() {
    return {
      find: attrs => this.find(attrs),
      replace: attrs => this.replace(attrs),
      replaceAll: attrs => this.replaceAll(attrs),
      clearSearch: () => this.clear()
    };
  }

  get findRegExp() {
    return RegExp(this.searchTerm, !this.options.caseSensitive ? 'gui' : 'gu');
  }

  get decorations() {
    return this.results.map(deco => Decoration.inline(deco.from, deco.to, {
      class: this.options.findClass
    }));
  }

  _search(doc) {
    this.results = [];
    const mergedTextNodes = [];
    let index = 0;

    if (!this.searchTerm) {
      return;
    }

    doc.descendants((node, pos) => {
      if (node.isText) {
        if (mergedTextNodes[index]) {
          mergedTextNodes[index] = {
            text: mergedTextNodes[index].text + node.text,
            pos: mergedTextNodes[index].pos
          };
        } else {
          mergedTextNodes[index] = {
            text: node.text,
            pos
          };
        }
      } else {
        index += 1;
      }
    });
    mergedTextNodes.forEach(({
      text,
      pos
    }) => {
      const search = this.findRegExp;
      let m; // eslint-disable-next-line no-cond-assign

      while (m = search.exec(text)) {
        if (m[0] === '') {
          break;
        }

        this.results.push({
          from: pos + m.index,
          to: pos + m.index + m[0].length
        });
      }
    });
  }

  replace(replace) {
    return (state, dispatch) => {
      const firstResult = this.results[0];

      if (!firstResult) {
        return;
      }

      const {
        from,
        to
      } = this.results[0];
      dispatch(state.tr.insertText(replace, from, to));
      this.editor.commands.find(this.searchTerm);
    };
  }

  rebaseNextResult(replace, index, lastOffset = 0) {
    const nextIndex = index + 1;

    if (!this.results[nextIndex]) {
      return null;
    }

    const {
      from: currentFrom,
      to: currentTo
    } = this.results[index];
    const offset = currentTo - currentFrom - replace.length + lastOffset;
    const {
      from,
      to
    } = this.results[nextIndex];
    this.results[nextIndex] = {
      to: to - offset,
      from: from - offset
    };
    return offset;
  }

  replaceAll(replace) {
    return ({
      tr
    }, dispatch) => {
      let offset;

      if (!this.results.length) {
        return;
      }

      this.results.forEach(({
        from,
        to
      }, index) => {
        tr.insertText(replace, from, to);
        offset = this.rebaseNextResult(replace, index, offset);
      });
      dispatch(tr);
      this.editor.commands.find(this.searchTerm);
    };
  }

  find(searchTerm) {
    return (state, dispatch) => {
      this.searchTerm = this.options.disableRegex ? searchTerm.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : searchTerm;
      this.updateView(state, dispatch);
    };
  }

  clear() {
    return (state, dispatch) => {
      this.searchTerm = null;
      this.updateView(state, dispatch);
    };
  }

  updateView({
    tr
  }, dispatch) {
    this._updating = true;
    dispatch(tr);
    this._updating = false;
  }

  createDeco(doc) {
    this._search(doc);

    return this.decorations ? DecorationSet.create(doc, this.decorations) : [];
  }

  get plugins() {
    return [new Plugin({
      state: {
        init() {
          return DecorationSet.empty;
        },

        apply: (tr, old) => {
          if (this._updating || this.options.searching || tr.docChanged && this.options.alwaysSearch) {
            return this.createDeco(tr.doc);
          }

          if (tr.docChanged) {
            return old.map(tr.mapping, tr.doc);
          }

          return old;
        }
      },
      props: {
        decorations(state) {
          return this.getState(state);
        }

      }
    })];
  }

}

class TrailingNode extends Extension {
  get name() {
    return 'trailing_node';
  }

  get defaultOptions() {
    return {
      node: 'paragraph',
      notAfter: ['paragraph']
    };
  }

  get plugins() {
    const plugin = new PluginKey(this.name);
    const disabledNodes = Object.entries(this.editor.schema.nodes).map(([, value]) => value).filter(node => this.options.notAfter.includes(node.name));
    return [new Plugin({
      key: plugin,
      view: () => ({
        update: view => {
          const {
            state
          } = view;
          const insertNodeAtEnd = plugin.getState(state);

          if (!insertNodeAtEnd) {
            return;
          }

          const {
            doc,
            schema,
            tr
          } = state;
          const type = schema.nodes[this.options.node];
          const transaction = tr.insert(doc.content.size, type.create());
          view.dispatch(transaction);
        }
      }),
      state: {
        init: (_, state) => {
          const lastNode = state.tr.doc.lastChild;
          return !nodeEqualsType({
            node: lastNode,
            types: disabledNodes
          });
        },
        apply: (tr, value) => {
          if (!tr.docChanged) {
            return value;
          }

          const lastNode = tr.doc.lastChild;
          return !nodeEqualsType({
            node: lastNode,
            types: disabledNodes
          });
        }
      }
    })];
  }

}

export { Blockquote, Bold, BulletList, Code, CodeBlock, CodeBlockHighlight, Collaboration, Focus, HardBreak, Heading, HighlightPlugin as Highlight, History, HorizontalRule, Image, Italic, Link, ListItem, Mention, OrderedList, Placeholder, Search, Strike, SuggestionsPlugin as Suggestions, Table, TableCell, TableHeader, TableRow, TodoItem, TodoList, TrailingNode, Underline };
