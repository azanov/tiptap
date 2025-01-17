
    /*!
    * tiptap v1.30.0
    * (c) 2021 überdosis GbR (limited liability)
    * @license MIT
    */
  
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
export { NodeSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { inputRules, undoInputRule } from 'prosemirror-inputrules';
import { getMarkRange, markIsActive, getMarkAttrs, nodeIsActive, getNodeAttrs } from 'tiptap-utils';
import { defineComponent, h } from 'vue';
import { setBlockType } from 'tiptap-commands';

function camelCase (str) {
  return str.replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 ? word.toLowerCase() : word.toUpperCase()).replace(/\s+/g, '');
}

class ComponentView {
  constructor(component, {
    editor,
    extension,
    parent,
    node,
    view,
    decorations,
    getPos
  }) {
    // eslint-disable-next-line no-console
    console.log('create component');
    this.component = component;
    this.editor = editor;
    this.extension = extension;
    this.parent = parent;
    this.node = node;
    this.view = view;
    this.decorations = decorations;
    this.isNode = !!this.node.marks;
    this.isMark = !this.isNode;
    this.getPos = this.isMark ? this.getMarkPos : getPos;
    this.captureEvents = true;
    this.dom = this.createDOM();
    this.contentDOM = this.vm.$refs.content;
  }

  createDOM() {
    const Component = defineComponent(this.component);
    const props = {
      editor: this.editor,
      node: this.node,
      view: this.view,
      getPos: () => this.getPos(),
      decorations: this.decorations,
      selected: false,
      options: this.extension.options,
      updateAttrs: attrs => this.updateAttrs(attrs)
    };

    if (typeof this.extension.setSelection === 'function') {
      this.setSelection = this.extension.setSelection;
    }

    if (typeof this.extension.update === 'function') {
      this.update = this.extension.update;
    }

    this.vm = new Component({
      parent: this.parent,
      propsData: props
    }).$mount();
    return this.vm.$el;
  }

  update(node, decorations) {
    if (node.type !== this.node.type) {
      return false;
    }

    if (node === this.node && this.decorations === decorations) {
      return true;
    }

    this.node = node;
    this.decorations = decorations;
    this.updateComponentProps({
      node,
      decorations
    });
    return true;
  }

  updateComponentProps(props) {
    if (!this.vm._.props) {
      return;
    } // Update props in component
    // TODO: Avoid mutating a prop directly.
    // Maybe there is a better way to do this?


    Object.entries(props).forEach(([key, value]) => {
      this.vm._.props[key] = value;
    }); // this.vm._props.node = node
    // this.vm._props.decorations = decorations
  }

  updateAttrs(attrs) {
    if (!this.view.editable) {
      return;
    }

    const {
      state
    } = this.view;
    const {
      type
    } = this.node;
    const pos = this.getPos();
    const newAttrs = { ...this.node.attrs,
      ...attrs
    };
    const transaction = this.isMark ? state.tr.removeMark(pos.from, pos.to, type).addMark(pos.from, pos.to, type.create(newAttrs)) : state.tr.setNodeMarkup(pos, null, newAttrs);
    this.view.dispatch(transaction);
  } // prevent a full re-render of the vue component on update
  // we'll handle prop updates in `update()`


  ignoreMutation(mutation) {
    // allow leaf nodes to be selected
    if (mutation.type === 'selection') {
      return false;
    }

    if (!this.contentDOM) {
      return true;
    }

    return !this.contentDOM.contains(mutation.target);
  } // disable (almost) all prosemirror event listener for node views


  stopEvent(event) {
    if (typeof this.extension.stopEvent === 'function') {
      return this.extension.stopEvent(event);
    }

    const draggable = !!this.extension.schema.draggable; // support a custom drag handle

    if (draggable && event.type === 'mousedown') {
      const dragHandle = event.target.closest && event.target.closest('[data-drag-handle]');
      const isValidDragHandle = dragHandle && (this.dom === dragHandle || this.dom.contains(dragHandle));

      if (isValidDragHandle) {
        this.captureEvents = false;
        document.addEventListener('dragend', () => {
          this.captureEvents = true;
        }, {
          once: true
        });
      }
    }

    const isCopy = event.type === 'copy';
    const isPaste = event.type === 'paste';
    const isCut = event.type === 'cut';
    const isDrag = event.type.startsWith('drag') || event.type === 'drop';

    if (draggable && isDrag || isCopy || isPaste || isCut) {
      return false;
    }

    return this.captureEvents;
  }

  selectNode() {
    this.updateComponentProps({
      selected: true
    });
  }

  deselectNode() {
    this.updateComponentProps({
      selected: false
    });
  }

  getMarkPos() {
    const pos = this.view.posAtDOM(this.dom);
    const resolvedPos = this.view.state.doc.resolve(pos);
    const range = getMarkRange(resolvedPos, this.node.type);
    return range;
  }

  destroy() {// this.vm.$destroy()
  }

}

class Emitter {
  // Add an event listener for given event
  on(event, fn) {
    this._callbacks = this._callbacks || {}; // Create namespace for this event

    if (!this._callbacks[event]) {
      this._callbacks[event] = [];
    }

    this._callbacks[event].push(fn);

    return this;
  }

  emit(event, ...args) {
    this._callbacks = this._callbacks || {};
    const callbacks = this._callbacks[event];

    if (callbacks) {
      callbacks.forEach(callback => callback.apply(this, args));
    }

    return this;
  } // Remove event listener for given event.
  // If fn is not provided, all event listeners for that event will be removed.
  // If neither is provided, all event listeners will be removed.


  off(event, fn) {
    if (!arguments.length) {
      this._callbacks = {};
    } else {
      // event listeners for the given event
      const callbacks = this._callbacks ? this._callbacks[event] : null;

      if (callbacks) {
        if (fn) {
          this._callbacks[event] = callbacks.filter(cb => cb !== fn); // remove specific handler
        } else {
          delete this._callbacks[event]; // remove all handlers
        }
      }
    }

    return this;
  }

}

class Extension {
  constructor(options = {}) {
    this.options = { ...this.defaultOptions,
      ...options
    };
  }

  init() {
    return null;
  }

  bindEditor(editor = null) {
    this.editor = editor;
  }

  get name() {
    return null;
  }

  get type() {
    return 'extension';
  }

  get defaultOptions() {
    return {};
  }

  get plugins() {
    return [];
  }

  inputRules() {
    return [];
  }

  pasteRules() {
    return [];
  }

  keys() {
    return {};
  }

}

class ExtensionManager {
  constructor(extensions = [], editor) {
    extensions.forEach(extension => {
      extension.bindEditor(editor);
      extension.init();
    });
    this.extensions = extensions;
  }

  get nodes() {
    return this.extensions.filter(extension => extension.type === 'node').reduce((nodes, {
      name,
      schema
    }) => ({ ...nodes,
      [name]: schema
    }), {});
  }

  get options() {
    const {
      view
    } = this;
    return this.extensions.reduce((nodes, extension) => ({ ...nodes,
      [extension.name]: new Proxy(extension.options, {
        set(obj, prop, value) {
          const changed = obj[prop] !== value;
          Object.assign(obj, {
            [prop]: value
          });

          if (changed) {
            view.updateState(view.state);
          }

          return true;
        }

      })
    }), {});
  }

  get marks() {
    return this.extensions.filter(extension => extension.type === 'mark').reduce((marks, {
      name,
      schema
    }) => ({ ...marks,
      [name]: schema
    }), {});
  }

  get plugins() {
    return this.extensions.filter(extension => extension.plugins).reduce((allPlugins, {
      plugins
    }) => [...allPlugins, ...plugins], []);
  }

  keymaps({
    schema
  }) {
    const extensionKeymaps = this.extensions.filter(extension => ['extension'].includes(extension.type)).filter(extension => extension.keys).map(extension => extension.keys({
      schema
    }));
    const nodeMarkKeymaps = this.extensions.filter(extension => ['node', 'mark'].includes(extension.type)).filter(extension => extension.keys).map(extension => extension.keys({
      type: schema["".concat(extension.type, "s")][extension.name],
      schema
    }));
    return [...extensionKeymaps, ...nodeMarkKeymaps].map(keys => keymap(keys));
  }

  inputRules({
    schema,
    excludedExtensions
  }) {
    if (!(excludedExtensions instanceof Array) && excludedExtensions) return [];
    const allowedExtensions = excludedExtensions instanceof Array ? this.extensions.filter(extension => !excludedExtensions.includes(extension.name)) : this.extensions;
    const extensionInputRules = allowedExtensions.filter(extension => ['extension'].includes(extension.type)).filter(extension => extension.inputRules).map(extension => extension.inputRules({
      schema
    }));
    const nodeMarkInputRules = allowedExtensions.filter(extension => ['node', 'mark'].includes(extension.type)).filter(extension => extension.inputRules).map(extension => extension.inputRules({
      type: schema["".concat(extension.type, "s")][extension.name],
      schema
    }));
    return [...extensionInputRules, ...nodeMarkInputRules].reduce((allInputRules, inputRules) => [...allInputRules, ...inputRules], []);
  }

  pasteRules({
    schema,
    excludedExtensions
  }) {
    if (!(excludedExtensions instanceof Array) && excludedExtensions) return [];
    const allowedExtensions = excludedExtensions instanceof Array ? this.extensions.filter(extension => !excludedExtensions.includes(extension.name)) : this.extensions;
    const extensionPasteRules = allowedExtensions.filter(extension => ['extension'].includes(extension.type)).filter(extension => extension.pasteRules).map(extension => extension.pasteRules({
      schema
    }));
    const nodeMarkPasteRules = allowedExtensions.filter(extension => ['node', 'mark'].includes(extension.type)).filter(extension => extension.pasteRules).map(extension => extension.pasteRules({
      type: schema["".concat(extension.type, "s")][extension.name],
      schema
    }));
    return [...extensionPasteRules, ...nodeMarkPasteRules].reduce((allPasteRules, pasteRules) => [...allPasteRules, ...pasteRules], []);
  }

  commands({
    schema,
    view
  }) {
    return this.extensions.filter(extension => extension.commands).reduce((allCommands, extension) => {
      const {
        name,
        type
      } = extension;
      const commands = {};
      const value = extension.commands({
        schema,
        ...(['node', 'mark'].includes(type) ? {
          type: schema["".concat(type, "s")][name]
        } : {})
      });

      const apply = (cb, attrs) => {
        if (!view.editable) {
          return false;
        }

        view.focus();
        return cb(attrs)(view.state, view.dispatch, view);
      };

      const handle = (_name, _value) => {
        if (Array.isArray(_value)) {
          commands[_name] = attrs => _value.forEach(callback => apply(callback, attrs));
        } else if (typeof _value === 'function') {
          commands[_name] = attrs => apply(_value, attrs);
        }
      };

      if (typeof value === 'object') {
        Object.entries(value).forEach(([commandName, commandValue]) => {
          handle(commandName, commandValue);
        });
      } else {
        handle(name, value);
      }

      return { ...allCommands,
        ...commands
      };
    }, {});
  }

}

function injectCSS (css) {
  if (process.env.NODE_ENV !== 'test') {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = css;
    const {
      head
    } = document;
    const {
      firstChild
    } = head;

    if (firstChild) {
      head.insertBefore(style, firstChild);
    } else {
      head.appendChild(style);
    }
  }
}

class Mark extends Extension {
  constructor(options = {}) {
    super(options);
  }

  get type() {
    return 'mark';
  }

  get view() {
    return null;
  }

  get schema() {
    return null;
  }

  command() {
    return () => {};
  }

}

function minMax(value = 0, min = 0, max = 0) {
  return Math.min(Math.max(parseInt(value, 10), min), max);
}

class Node extends Extension {
  constructor(options = {}) {
    super(options);
  }

  get type() {
    return 'node';
  }

  get view() {
    return null;
  }

  get schema() {
    return null;
  }

  command() {
    return () => {};
  }

}

class Doc extends Node {
  get name() {
    return 'doc';
  }

  get schema() {
    return {
      content: 'block+'
    };
  }

}

class Paragraph extends Node {
  get name() {
    return 'paragraph';
  }

  get schema() {
    return {
      content: 'inline*',
      group: 'block',
      draggable: false,
      parseDOM: [{
        tag: 'p'
      }],
      toDOM: () => ['p', 0]
    };
  }

  commands({
    type
  }) {
    return () => setBlockType(type);
  }

}

class Text extends Node {
  get name() {
    return 'text';
  }

  get schema() {
    return {
      group: 'inline'
    };
  }

}

var css = ".ProseMirror {\r\n  position: relative;\r\n}\r\n\r\n.ProseMirror {\r\n  word-wrap: break-word;\r\n  white-space: pre-wrap;\r\n  -webkit-font-variant-ligatures: none;\r\n  font-variant-ligatures: none;\r\n}\r\n\r\n.ProseMirror pre {\r\n  white-space: pre-wrap;\r\n}\r\n\r\n.ProseMirror-gapcursor {\r\n  display: none;\r\n  pointer-events: none;\r\n  position: absolute;\r\n}\r\n\r\n.ProseMirror-gapcursor:after {\r\n  content: \"\";\r\n  display: block;\r\n  position: absolute;\r\n  top: -2px;\r\n  width: 20px;\r\n  border-top: 1px solid black;\r\n  animation: ProseMirror-cursor-blink 1.1s steps(2, start) infinite;\r\n}\r\n\r\n@keyframes ProseMirror-cursor-blink {\r\n  to {\r\n    visibility: hidden;\r\n  }\r\n}\r\n\r\n.ProseMirror-hideselection *::selection {\r\n  background: transparent;\r\n}\r\n\r\n.ProseMirror-hideselection *::-moz-selection {\r\n  background: transparent;\r\n}\r\n\r\n.ProseMirror-hideselection * {\r\n  caret-color: transparent;\r\n}\r\n\r\n.ProseMirror-focused .ProseMirror-gapcursor {\r\n  display: block;\r\n}\r\n";

class Editor extends Emitter {
  constructor(options = {}) {
    super();
    this.defaultOptions = {
      editorProps: {},
      editable: true,
      autoFocus: null,
      extensions: [],
      content: '',
      topNode: 'doc',
      emptyDocument: {
        type: 'doc',
        content: [{
          type: 'paragraph'
        }]
      },
      useBuiltInExtensions: true,
      disableInputRules: false,
      disablePasteRules: false,
      dropCursor: {},
      enableDropCursor: true,
      enableGapCursor: true,
      parseOptions: {},
      injectCSS: true,
      onInit: () => {},
      onTransaction: () => {},
      onUpdate: () => {},
      onFocus: () => {},
      onBlur: () => {},
      onPaste: () => {},
      onDrop: () => {}
    };
    this.events = ['init', 'transaction', 'update', 'focus', 'blur', 'paste', 'drop'];
    this.init(options);
  }

  init(options = {}) {
    this.setOptions({ ...this.defaultOptions,
      ...options
    });
    this.focused = false;
    this.selection = {
      from: 0,
      to: 0
    };
    this.element = document.createElement('div');
    this.extensions = this.createExtensions();
    this.nodes = this.createNodes();
    this.marks = this.createMarks();
    this.schema = this.createSchema();
    this.plugins = this.createPlugins();
    this.keymaps = this.createKeymaps();
    this.inputRules = this.createInputRules();
    this.pasteRules = this.createPasteRules();
    this.view = this.createView();
    this.commands = this.createCommands();
    this.setActiveNodesAndMarks();

    if (this.options.injectCSS) {
      injectCSS(css);
    }

    if (this.options.autoFocus !== null) {
      this.focus(this.options.autoFocus);
    }

    this.events.forEach(name => {
      this.on(name, this.options[camelCase("on ".concat(name))] || (() => {}));
    });
    this.emit('init', {
      view: this.view,
      state: this.state
    }); // give extension manager access to our view

    this.extensions.view = this.view;
  }

  setOptions(options) {
    this.options = { ...this.options,
      ...options
    };

    if (this.view && this.state) {
      this.view.updateState(this.state);
    }
  }

  get builtInExtensions() {
    if (!this.options.useBuiltInExtensions) {
      return [];
    }

    return [new Doc(), new Text(), new Paragraph()];
  }

  get state() {
    return this.view ? this.view.state : null;
  }

  createExtensions() {
    return new ExtensionManager([...this.builtInExtensions, ...this.options.extensions], this);
  }

  createPlugins() {
    return this.extensions.plugins;
  }

  createKeymaps() {
    return this.extensions.keymaps({
      schema: this.schema
    });
  }

  createInputRules() {
    return this.extensions.inputRules({
      schema: this.schema,
      excludedExtensions: this.options.disableInputRules
    });
  }

  createPasteRules() {
    return this.extensions.pasteRules({
      schema: this.schema,
      excludedExtensions: this.options.disablePasteRules
    });
  }

  createCommands() {
    return this.extensions.commands({
      schema: this.schema,
      view: this.view
    });
  }

  createNodes() {
    return this.extensions.nodes;
  }

  createMarks() {
    return this.extensions.marks;
  }

  createSchema() {
    return new Schema({
      topNode: this.options.topNode,
      nodes: this.nodes,
      marks: this.marks
    });
  }

  createState() {
    return EditorState.create({
      schema: this.schema,
      doc: this.createDocument(this.options.content),
      plugins: [...this.plugins, inputRules({
        rules: this.inputRules
      }), ...this.pasteRules, ...this.keymaps, keymap({
        Backspace: undoInputRule
      }), keymap(baseKeymap), ...(this.options.enableDropCursor ? [dropCursor(this.options.dropCursor)] : []), ...(this.options.enableGapCursor ? [gapCursor()] : []), new Plugin({
        key: new PluginKey('editable'),
        props: {
          editable: () => this.options.editable
        }
      }), new Plugin({
        props: {
          attributes: {
            tabindex: 0
          },
          handleDOMEvents: {
            focus: (view, event) => {
              this.focused = true;
              this.emit('focus', {
                event,
                state: view.state,
                view
              });
              const transaction = this.state.tr.setMeta('focused', true);
              this.view.dispatch(transaction);
            },
            blur: (view, event) => {
              this.focused = false;
              this.emit('blur', {
                event,
                state: view.state,
                view
              });
              const transaction = this.state.tr.setMeta('focused', false);
              this.view.dispatch(transaction);
            }
          }
        }
      }), new Plugin({
        props: this.options.editorProps
      })]
    });
  }

  createDocument(content, parseOptions = this.options.parseOptions) {
    if (content === null) {
      return this.schema.nodeFromJSON(this.options.emptyDocument);
    }

    if (typeof content === 'object') {
      try {
        return this.schema.nodeFromJSON(content);
      } catch (error) {
        console.warn('[tiptap warn]: Invalid content.', 'Passed value:', content, 'Error:', error);
        return this.schema.nodeFromJSON(this.options.emptyDocument);
      }
    }

    if (typeof content === 'string') {
      const htmlString = "<div>".concat(content, "</div>");
      const parser = new window.DOMParser();
      const element = parser.parseFromString(htmlString, 'text/html').body.firstElementChild;
      return DOMParser.fromSchema(this.schema).parse(element, parseOptions);
    }

    return false;
  }

  createView() {
    return new EditorView(this.element, {
      state: this.createState(),
      handlePaste: (...args) => {
        this.emit('paste', ...args);
      },
      handleDrop: (...args) => {
        this.emit('drop', ...args);
      },
      dispatchTransaction: this.dispatchTransaction.bind(this)
    });
  }

  setParentComponent(component = null) {
    if (!component) {
      return;
    }

    this.view.setProps({
      nodeViews: this.initNodeViews({
        parent: component,
        extensions: [...this.builtInExtensions, ...this.options.extensions]
      })
    });
  }

  initNodeViews({
    parent,
    extensions
  }) {
    return extensions.filter(extension => ['node', 'mark'].includes(extension.type)).filter(extension => extension.view).reduce((nodeViews, extension) => {
      const nodeView = (node, view, getPos, decorations) => {
        const component = extension.view;
        return new ComponentView(component, {
          editor: this,
          extension,
          parent,
          node,
          view,
          getPos,
          decorations
        });
      };

      return { ...nodeViews,
        [extension.name]: nodeView
      };
    }, {});
  }

  dispatchTransaction(transaction) {
    const newState = this.state.apply(transaction);
    this.view.updateState(newState);
    this.selection = {
      from: this.state.selection.from,
      to: this.state.selection.to
    };
    this.setActiveNodesAndMarks();
    this.emit('transaction', {
      getHTML: this.getHTML.bind(this),
      getJSON: this.getJSON.bind(this),
      state: this.state,
      transaction
    });

    if (!transaction.docChanged || transaction.getMeta('preventUpdate')) {
      return;
    }

    this.emitUpdate(transaction);
  }

  emitUpdate(transaction) {
    this.emit('update', {
      getHTML: this.getHTML.bind(this),
      getJSON: this.getJSON.bind(this),
      state: this.state,
      transaction
    });
  }

  resolveSelection(position = null) {
    if (this.selection && position === null) {
      return this.selection;
    }

    if (position === 'start' || position === true) {
      return {
        from: 0,
        to: 0
      };
    }

    if (position === 'end') {
      const {
        doc
      } = this.state;
      return {
        from: doc.content.size,
        to: doc.content.size
      };
    }

    return {
      from: position,
      to: position
    };
  }

  focus(position = null) {
    if (this.view.focused && position === null || position === false) {
      return;
    }

    const {
      from,
      to
    } = this.resolveSelection(position);
    this.setSelection(from, to);
    setTimeout(() => this.view.focus(), 10);
  }

  setSelection(from = 0, to = 0) {
    const {
      doc,
      tr
    } = this.state;
    const resolvedFrom = minMax(from, 0, doc.content.size);
    const resolvedEnd = minMax(to, 0, doc.content.size);
    const selection = TextSelection.create(doc, resolvedFrom, resolvedEnd);
    const transaction = tr.setSelection(selection);
    this.view.dispatch(transaction);
  }

  blur() {
    this.view.dom.blur();
  }

  getSchemaJSON() {
    return JSON.parse(JSON.stringify({
      nodes: this.extensions.nodes,
      marks: this.extensions.marks
    }));
  }

  getHTML() {
    const div = document.createElement('div');
    const fragment = DOMSerializer.fromSchema(this.schema).serializeFragment(this.state.doc.content);
    div.appendChild(fragment);
    return div.innerHTML;
  }

  getJSON() {
    return this.state.doc.toJSON();
  }

  setContent(content = {}, emitUpdate = false, parseOptions) {
    const {
      doc,
      tr
    } = this.state;
    const document = this.createDocument(content, parseOptions);
    const selection = TextSelection.create(doc, 0, doc.content.size);
    const transaction = tr.setSelection(selection).replaceSelectionWith(document, false).setMeta('preventUpdate', !emitUpdate);
    this.view.dispatch(transaction);
  }

  clearContent(emitUpdate = false) {
    this.setContent(this.options.emptyDocument, emitUpdate);
  }

  setActiveNodesAndMarks() {
    this.activeMarks = Object.entries(this.schema.marks).reduce((marks, [name, mark]) => ({ ...marks,
      [name]: (attrs = {}) => markIsActive(this.state, mark, attrs)
    }), {});
    this.activeMarkAttrs = Object.entries(this.schema.marks).reduce((marks, [name, mark]) => ({ ...marks,
      [name]: getMarkAttrs(this.state, mark)
    }), {});
    this.activeNodes = Object.entries(this.schema.nodes).reduce((nodes, [name, node]) => ({ ...nodes,
      [name]: (attrs = {}) => nodeIsActive(this.state, node, attrs)
    }), {});
  }

  getMarkAttrs(type = null) {
    return this.activeMarkAttrs[type];
  }

  getNodeAttrs(type = null) {
    return { ...getNodeAttrs(this.state, this.schema.nodes[type])
    };
  }

  get isActive() {
    return Object.entries({ ...this.activeMarks,
      ...this.activeNodes
    }).reduce((types, [name, value]) => ({ ...types,
      [name]: (attrs = {}) => value(attrs)
    }), {});
  }

  registerPlugin(plugin = null, handlePlugins) {
    const plugins = typeof handlePlugins === 'function' ? handlePlugins(plugin, this.state.plugins) : [plugin, ...this.state.plugins];
    const newState = this.state.reconfigure({
      plugins
    });
    this.view.updateState(newState);
  }

  unregisterPlugin(name = null) {
    if (!name || !this.view.docView) {
      return;
    }

    const newState = this.state.reconfigure({
      plugins: this.state.plugins.filter(plugin => !plugin.key.startsWith("".concat(name, "$")))
    });
    this.view.updateState(newState);
  }

  destroy() {
    if (!this.view) {
      return;
    }

    this.view.destroy();
  }

}

var EditorContent = {
  props: {
    editor: {
      default: null,
      type: Object
    }
  },
  watch: {
    editor: {
      immediate: true,

      handler(editor) {
        if (editor && editor.element) {
          this.$nextTick(() => {
            this.$el.appendChild(editor.element.firstChild);
            editor.setParentComponent(this);
          });
        }
      }

    }
  },

  render() {
    return h('div');
  },

  beforeUnmount() {
    this.editor.element = this.$el;
  }

};

class Menu {
  constructor({
    options
  }) {
    this.options = options;
    this.preventHide = false; // the mousedown event is fired before blur so we can prevent it

    this.mousedownHandler = this.handleClick.bind(this);
    this.options.element.addEventListener('mousedown', this.mousedownHandler, {
      capture: true
    });

    this.blurHandler = () => {
      if (this.preventHide) {
        this.preventHide = false;
        return;
      }

      this.options.editor.emit('menubar:focusUpdate', false);
    };

    this.options.editor.on('blur', this.blurHandler);
  }

  handleClick() {
    this.preventHide = true;
  }

  destroy() {
    this.options.element.removeEventListener('mousedown', this.mousedownHandler);
    this.options.editor.off('blur', this.blurHandler);
  }

}

function MenuBar (options) {
  return new Plugin({
    key: new PluginKey('menu_bar'),

    view(editorView) {
      return new Menu({
        editorView,
        options
      });
    }

  });
}

var EditorMenuBar = {
  props: {
    editor: {
      default: null,
      type: Object
    }
  },

  data() {
    return {
      focused: false
    };
  },

  watch: {
    editor: {
      immediate: true,

      handler(editor) {
        if (editor) {
          this.$nextTick(() => {
            editor.registerPlugin(MenuBar({
              editor,
              element: this.$el
            }));
            this.focused = editor.focused;
            editor.on('focus', () => {
              this.focused = true;
            });
            editor.on('menubar:focusUpdate', focused => {
              this.focused = focused;
            });
          });
        }
      }

    }
  },

  render() {
    if (!this.editor) {
      return null;
    }

    return this.$slots.default({
      focused: this.focused,
      focus: this.editor.focus,
      commands: this.editor.commands,
      isActive: this.editor.isActive,
      getMarkAttrs: this.editor.getMarkAttrs.bind(this.editor),
      getNodeAttrs: this.editor.getNodeAttrs.bind(this.editor)
    });
  }

};

function textRange(node, from, to) {
  const range = document.createRange();
  range.setEnd(node, to == null ? node.nodeValue.length : to);
  range.setStart(node, from || 0);
  return range;
}

function singleRect(object, bias) {
  const rects = object.getClientRects();
  return !rects.length ? object.getBoundingClientRect() : rects[bias < 0 ? 0 : rects.length - 1];
}

function coordsAtPos(view, pos, end = false) {
  const {
    node,
    offset
  } = view.docView.domFromPos(pos);
  let side;
  let rect;

  if (node.nodeType === 3) {
    if (end && offset < node.nodeValue.length) {
      rect = singleRect(textRange(node, offset - 1, offset), -1);
      side = 'right';
    } else if (offset < node.nodeValue.length) {
      rect = singleRect(textRange(node, offset, offset + 1), -1);
      side = 'left';
    }
  } else if (node.firstChild) {
    if (offset < node.childNodes.length) {
      const child = node.childNodes[offset];
      rect = singleRect(child.nodeType === 3 ? textRange(child) : child, -1);
      side = 'left';
    }

    if ((!rect || rect.top === rect.bottom) && offset) {
      const child = node.childNodes[offset - 1];
      rect = singleRect(child.nodeType === 3 ? textRange(child) : child, 1);
      side = 'right';
    }
  } else {
    rect = node.getBoundingClientRect();
    side = 'left';
  }

  const x = rect[side];
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: x,
    right: x
  };
}

class Menu$1 {
  constructor({
    options,
    editorView
  }) {
    this.options = { ...{
        element: null,
        keepInBounds: true,
        onUpdate: () => false
      },
      ...options
    };
    this.editorView = editorView;
    this.isActive = false;
    this.left = 0;
    this.bottom = 0;
    this.top = 0;
    this.preventHide = false; // the mousedown event is fired before blur so we can prevent it

    this.mousedownHandler = this.handleClick.bind(this);
    this.options.element.addEventListener('mousedown', this.mousedownHandler, {
      capture: true
    });

    this.focusHandler = ({
      view
    }) => {
      this.update(view);
    };

    this.options.editor.on('focus', this.focusHandler);

    this.blurHandler = ({
      event
    }) => {
      if (this.preventHide) {
        this.preventHide = false;
        return;
      }

      this.hide(event);
    };

    this.options.editor.on('blur', this.blurHandler);
  }

  handleClick() {
    this.preventHide = true;
  }

  update(view, lastState) {
    const {
      state
    } = view;

    if (view.composing) {
      return;
    } // Don't do anything if the document/selection didn't change


    if (lastState && lastState.doc.eq(state.doc) && lastState.selection.eq(state.selection)) {
      return;
    } // Hide the tooltip if the selection is empty


    if (state.selection.empty) {
      this.hide();
      return;
    } // Otherwise, reposition it and update its content


    const {
      from,
      to
    } = state.selection; // These are in screen coordinates
    // We can't use EditorView.cordsAtPos here because it can't handle linebreaks correctly
    // See: https://github.com/ProseMirror/prosemirror-view/pull/47

    const start = coordsAtPos(view, from);
    const end = coordsAtPos(view, to, true); // The box in which the tooltip is positioned, to use as base

    const parent = this.options.element.offsetParent;

    if (!parent) {
      this.hide();
      return;
    }

    const box = parent.getBoundingClientRect();
    const el = this.options.element.getBoundingClientRect(); // Find a center-ish x position from the selection endpoints (when
    // crossing lines, end may be more to the left)

    const left = (start.left + end.left) / 2 - box.left; // Keep the menuBubble in the bounding box of the offsetParent i

    this.left = Math.round(this.options.keepInBounds ? Math.min(box.width - el.width / 2, Math.max(left, el.width / 2)) : left);
    this.bottom = Math.round(box.bottom - start.top);
    this.top = Math.round(end.bottom - box.top);
    this.isActive = true;
    this.sendUpdate();
  }

  sendUpdate() {
    this.options.onUpdate({
      isActive: this.isActive,
      left: this.left,
      bottom: this.bottom,
      top: this.top
    });
  }

  hide(event) {
    if (event && event.relatedTarget && this.options.element.parentNode && this.options.element.parentNode.contains(event.relatedTarget)) {
      return;
    }

    this.isActive = false;
    this.sendUpdate();
  }

  destroy() {
    this.options.element.removeEventListener('mousedown', this.mousedownHandler);
    this.options.editor.off('focus', this.focusHandler);
    this.options.editor.off('blur', this.blurHandler);
  }

}

function MenuBubble (options) {
  return new Plugin({
    key: new PluginKey('menu_bubble'),

    view(editorView) {
      return new Menu$1({
        editorView,
        options
      });
    }

  });
}

var EditorMenuBubble = {
  props: {
    editor: {
      default: null,
      type: Object
    },
    keepInBounds: {
      default: true,
      type: Boolean
    }
  },

  data() {
    return {
      menu: {
        isActive: false,
        left: 0,
        bottom: 0
      }
    };
  },

  watch: {
    editor: {
      immediate: true,

      handler(editor) {
        if (editor) {
          this.$nextTick(() => {
            editor.registerPlugin(MenuBubble({
              editor,
              element: this.$el,
              keepInBounds: this.keepInBounds,
              onUpdate: menu => {
                // the second check ensures event is fired only once
                if (menu.isActive && this.menu.isActive === false) {
                  this.$emit('show', menu);
                } else if (!menu.isActive && this.menu.isActive === true) {
                  this.$emit('hide', menu);
                }

                this.menu = menu;
              }
            }));
          });
        }
      }

    }
  },

  render() {
    if (!this.editor) {
      return null;
    }

    return this.$slots.default({
      focused: this.editor.view.focused,
      focus: this.editor.focus,
      commands: this.editor.commands,
      isActive: this.editor.isActive,
      getMarkAttrs: this.editor.getMarkAttrs.bind(this.editor),
      getNodeAttrs: this.editor.getNodeAttrs.bind(this.editor),
      menu: this.menu
    });
  },

  beforeUnmount() {
    this.editor.unregisterPlugin('menu_bubble');
  }

};

class Menu$2 {
  constructor({
    options,
    editorView
  }) {
    this.options = { ...{
        resizeObserver: true,
        element: null,
        onUpdate: () => false
      },
      ...options
    };
    this.preventHide = false;
    this.editorView = editorView;
    this.isActive = false;
    this.top = 0; // the mousedown event is fired before blur so we can prevent it

    this.mousedownHandler = this.handleClick.bind(this);
    this.options.element.addEventListener('mousedown', this.mousedownHandler, {
      capture: true
    });

    this.focusHandler = ({
      view
    }) => {
      this.update(view);
    };

    this.options.editor.on('focus', this.focusHandler);

    this.blurHandler = ({
      event
    }) => {
      if (this.preventHide) {
        this.preventHide = false;
        return;
      }

      this.hide(event);
    };

    this.options.editor.on('blur', this.blurHandler); // sometimes we have to update the position
    // because of a loaded images for example

    if (this.options.resizeObserver && window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.isActive) {
          this.update(this.editorView);
        }
      });
      this.resizeObserver.observe(this.editorView.dom);
    }
  }

  handleClick() {
    this.preventHide = true;
  }

  update(view, lastState) {
    const {
      state
    } = view; // Don't do anything if the document/selection didn't change

    if (lastState && lastState.doc.eq(state.doc) && lastState.selection.eq(state.selection)) {
      return;
    }

    if (!state.selection.empty) {
      this.hide();
      return;
    }

    const currentDom = view.domAtPos(state.selection.anchor);
    const isActive = currentDom.node.innerHTML === '<br>' && currentDom.node.tagName === 'P' && currentDom.node.parentNode === view.dom;

    if (!isActive) {
      this.hide();
      return;
    }

    const parent = this.options.element.offsetParent;

    if (!parent) {
      this.hide();
      return;
    }

    const editorBoundings = parent.getBoundingClientRect();
    const cursorBoundings = view.coordsAtPos(state.selection.anchor);
    const top = cursorBoundings.top - editorBoundings.top;
    this.isActive = true;
    this.top = top;
    this.sendUpdate();
  }

  sendUpdate() {
    this.options.onUpdate({
      isActive: this.isActive,
      top: this.top
    });
  }

  hide(event) {
    if (event && event.relatedTarget && this.options.element.parentNode && this.options.element.parentNode.contains(event.relatedTarget)) {
      return;
    }

    this.isActive = false;
    this.sendUpdate();
  }

  destroy() {
    this.options.element.removeEventListener('mousedown', this.mousedownHandler);

    if (this.resizeObserver) {
      this.resizeObserver.unobserve(this.editorView.dom);
    }

    this.options.editor.off('focus', this.focusHandler);
    this.options.editor.off('blur', this.blurHandler);
  }

}

function FloatingMenu (options) {
  return new Plugin({
    key: new PluginKey('floating_menu'),

    view(editorView) {
      return new Menu$2({
        editorView,
        options
      });
    }

  });
}

var EditorFloatingMenu = {
  props: {
    editor: {
      default: null,
      type: Object
    }
  },

  data() {
    return {
      menu: {
        isActive: false,
        left: 0,
        bottom: 0
      }
    };
  },

  watch: {
    editor: {
      immediate: true,

      handler(editor) {
        if (editor) {
          this.$nextTick(() => {
            editor.registerPlugin(FloatingMenu({
              editor,
              element: this.$el,
              onUpdate: menu => {
                // the second check ensures event is fired only once
                if (menu.isActive && this.menu.isActive === false) {
                  this.$emit('show', menu);
                } else if (!menu.isActive && this.menu.isActive === true) {
                  this.$emit('hide', menu);
                }

                this.menu = menu;
              }
            }));
          });
        }
      }

    }
  },

  render() {
    if (!this.editor) {
      return null;
    }

    return this.$slots.default({
      focused: this.editor.view.focused,
      focus: this.editor.focus,
      commands: this.editor.commands,
      isActive: this.editor.isActive,
      getMarkAttrs: this.editor.getMarkAttrs.bind(this.editor),
      getNodeAttrs: this.editor.getNodeAttrs.bind(this.editor),
      menu: this.menu
    });
  },

  beforeUnmount() {
    this.editor.unregisterPlugin('floating_menu');
  }

};

export { Doc, Editor, EditorContent, EditorFloatingMenu, EditorMenuBar, EditorMenuBubble, Extension, Mark, Node, Paragraph, Text };
