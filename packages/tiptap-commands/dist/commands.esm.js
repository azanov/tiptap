
    /*!
    * tiptap-commands v1.15.0
    * (c) 2021 überdosis GbR (limited liability)
    * @license MIT
    */
  
import { setBlockType, lift, wrapIn } from 'prosemirror-commands';
export { autoJoin, baseKeymap, chainCommands, createParagraphNear, deleteSelection, exitCode, joinBackward, joinDown, joinForward, joinUp, lift, liftEmptyBlock, macBaseKeymap, newlineInCode, pcBaseKeymap, selectAll, selectNodeBackward, selectNodeForward, selectParentNode, setBlockType, splitBlock, splitBlockKeepMarks, toggleMark, wrapIn } from 'prosemirror-commands';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
export { addListNodes, liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { InputRule } from 'prosemirror-inputrules';
export { textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { Plugin } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import { getMarkRange, nodeIsActive } from 'tiptap-utils';
import { findParentNode } from 'prosemirror-utils';

function insertText (text = '') {
  return (state, dispatch) => {
    const {
      $from
    } = state.selection;
    const {
      pos
    } = $from.pos;
    dispatch(state.tr.insertText(text, pos));
    return true;
  };
}

function getMarksBetween(start, end, state) {
  let marks = [];
  state.doc.nodesBetween(start, end, (node, pos) => {
    marks = [...marks, ...node.marks.map(mark => ({
      start: pos,
      end: pos + node.nodeSize,
      mark
    }))];
  });
  return marks;
}

function markInputRule (regexp, markType, getAttrs) {
  return new InputRule(regexp, (state, match, start, end) => {
    const attrs = getAttrs instanceof Function ? getAttrs(match) : getAttrs;
    const {
      tr
    } = state;
    const m = match.length - 1;
    let markEnd = end;
    let markStart = start;

    if (match[m]) {
      const matchStart = start + match[0].indexOf(match[m - 1]);
      const matchEnd = matchStart + match[m - 1].length - 1;
      const textStart = matchStart + match[m - 1].lastIndexOf(match[m]);
      const textEnd = textStart + match[m].length;
      const excludedMarks = getMarksBetween(start, end, state).filter(item => {
        const {
          excluded
        } = item.mark.type;
        return excluded.find(type => type.name === markType.name);
      }).filter(item => item.end > matchStart);

      if (excludedMarks.length) {
        return false;
      }

      if (textEnd < matchEnd) {
        tr.delete(textEnd, matchEnd);
      }

      if (textStart > matchStart) {
        tr.delete(matchStart, textStart);
      }

      markStart = matchStart;
      markEnd = markStart + match[m].length;
    }

    tr.addMark(markStart, markEnd, markType.create(attrs));
    tr.removeStoredMark(markType);
    return tr;
  });
}

function nodeInputRule (regexp, type, getAttrs) {
  return new InputRule(regexp, (state, match, start, end) => {
    const attrs = getAttrs instanceof Function ? getAttrs(match) : getAttrs;
    const {
      tr
    } = state;

    if (match[0]) {
      tr.replaceWith(start - 1, end, type.create(attrs));
    }

    return tr;
  });
}

function pasteRule (regexp, type, getAttrs) {
  const handler = fragment => {
    const nodes = [];
    fragment.forEach(child => {
      if (child.isText) {
        const {
          text
        } = child;
        let pos = 0;
        let match;

        do {
          match = regexp.exec(text);

          if (match) {
            const start = match.index;
            const end = start + match[0].length;
            const attrs = getAttrs instanceof Function ? getAttrs(match[0]) : getAttrs;

            if (start > 0) {
              nodes.push(child.cut(pos, start));
            }

            nodes.push(child.cut(start, end).mark(type.create(attrs).addToSet(child.marks)));
            pos = end;
          }
        } while (match);

        if (pos < text.length) {
          nodes.push(child.cut(pos));
        }
      } else {
        nodes.push(child.copy(handler(child.content)));
      }
    });
    return Fragment.fromArray(nodes);
  };

  return new Plugin({
    props: {
      transformPasted: slice => new Slice(handler(slice.content), slice.openStart, slice.openEnd)
    }
  });
}

function markPasteRule (regexp, type, getAttrs) {
  const handler = (fragment, parent) => {
    const nodes = [];
    fragment.forEach(child => {
      if (child.isText) {
        const {
          text,
          marks
        } = child;
        let pos = 0;
        let match;
        const isLink = !!marks.filter(x => x.type.name === 'link')[0]; // eslint-disable-next-line

        while (!isLink && (match = regexp.exec(text)) !== null) {
          if (parent && parent.type.allowsMarkType(type) && match[1]) {
            const start = match.index;
            const end = start + match[0].length;
            const textStart = start + match[0].indexOf(match[1]);
            const textEnd = textStart + match[1].length;
            const attrs = getAttrs instanceof Function ? getAttrs(match) : getAttrs; // adding text before markdown to nodes

            if (start > 0) {
              nodes.push(child.cut(pos, start));
            } // adding the markdown part to nodes


            nodes.push(child.cut(textStart, textEnd).mark(type.create(attrs).addToSet(child.marks)));
            pos = end;
          }
        } // adding rest of text to nodes


        if (pos < text.length) {
          nodes.push(child.cut(pos));
        }
      } else {
        nodes.push(child.copy(handler(child.content, child)));
      }
    });
    return Fragment.fromArray(nodes);
  };

  return new Plugin({
    props: {
      transformPasted: slice => new Slice(handler(slice.content), slice.openStart, slice.openEnd)
    }
  });
}

function removeMark (type) {
  return (state, dispatch) => {
    const {
      tr,
      selection
    } = state;
    let {
      from,
      to
    } = selection;
    const {
      $from,
      empty
    } = selection;

    if (empty) {
      const range = getMarkRange($from, type);
      from = range.from;
      to = range.to;
    }

    tr.removeMark(from, to, type);
    return dispatch(tr);
  };
}

function replaceText (range = null, type, attrs = {}) {
  return (state, dispatch) => {
    const {
      $from,
      $to
    } = state.selection;
    const index = $from.index();
    const from = range ? range.from : $from.pos;
    const to = range ? range.to : $to.pos;

    if (!$from.parent.canReplaceWith(index, index, type)) {
      return false;
    }

    if (dispatch) {
      dispatch(state.tr.replaceWith(from, to, type.create(attrs)));
    }

    return true;
  };
}

function setInlineBlockType (type, attrs = {}) {
  return (state, dispatch) => {
    const {
      $from
    } = state.selection;
    const index = $from.index();

    if (!$from.parent.canReplaceWith(index, index, type)) {
      return false;
    }

    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(type.create(attrs)));
    }

    return true;
  };
}

// see https://github.com/ProseMirror/prosemirror-transform/blob/main/src/structure.js
// Since this piece of code was "borrowed" from prosemirror, ESLint rules are ignored.

/* eslint-disable max-len, no-plusplus, no-undef, eqeqeq */

function canSplit(doc, pos, depth = 1, typesAfter) {
  const $pos = doc.resolve(pos);
  const base = $pos.depth - depth;
  const innerType = typesAfter && typesAfter[typesAfter.length - 1] || $pos.parent;
  if (base < 0 || $pos.parent.type.spec.isolating || !$pos.parent.canReplace($pos.index(), $pos.parent.childCount) || !innerType.type.validContent($pos.parent.content.cutByIndex($pos.index(), $pos.parent.childCount))) return false;

  for (let d = $pos.depth - 1, i = depth - 2; d > base; d--, i--) {
    const node = $pos.node(d);
    const index = $pos.index(d);
    if (node.type.spec.isolating) return false;
    let rest = node.content.cutByIndex(index, node.childCount);
    const after = typesAfter && typesAfter[i] || node;
    if (after != node) rest = rest.replaceChild(0, after.type.create(after.attrs));
    /* Change starts from here */
    // if (!node.canReplace(index + 1, node.childCount) || !after.type.validContent(rest))
    //   return false

    if (!node.canReplace(index + 1, node.childCount)) return false;
    /* Change ends here */
  }

  const index = $pos.indexAfter(base);
  const baseType = typesAfter && typesAfter[0];
  return $pos.node(base).canReplaceWith(index, index, baseType ? baseType.type : $pos.node(base + 1).type);
} // this is a copy of splitListItem
// see https://github.com/ProseMirror/prosemirror-schema-list/blob/main/src/schema-list.js


function splitToDefaultListItem(itemType) {
  return function (state, dispatch) {
    const {
      $from,
      $to,
      node
    } = state.selection;
    if (node && node.isBlock || $from.depth < 2 || !$from.sameParent($to)) return false;
    const grandParent = $from.node(-1);
    if (grandParent.type != itemType) return false;

    if ($from.parent.content.size == 0) {
      // In an empty block. If this is a nested list, the wrapping
      // list item should be split. Otherwise, bail out and let next
      // command handle lifting.
      if ($from.depth == 2 || $from.node(-3).type != itemType || $from.index(-2) != $from.node(-2).childCount - 1) return false;

      if (dispatch) {
        let wrap = Fragment.empty;
        const keepItem = $from.index(-1) > 0; // Build a fragment containing empty versions of the structure
        // from the outer list item to the parent node of the cursor

        for (let d = $from.depth - (keepItem ? 1 : 2); d >= $from.depth - 3; d--) wrap = Fragment.from($from.node(d).copy(wrap)); // Add a second list item with an empty default start node


        wrap = wrap.append(Fragment.from(itemType.createAndFill()));
        const tr = state.tr.replace($from.before(keepItem ? null : -1), $from.after(-3), new Slice(wrap, keepItem ? 3 : 2, 2));
        tr.setSelection(state.selection.constructor.near(tr.doc.resolve($from.pos + (keepItem ? 3 : 2))));
        dispatch(tr.scrollIntoView());
      }

      return true;
    }

    const nextType = $to.pos == $from.end() ? grandParent.contentMatchAt($from.indexAfter(-1)).defaultType : null;
    const tr = state.tr.delete($from.pos, $to.pos);
    /* Change starts from here */
    // let types = nextType && [null, {type: nextType}]

    let types = nextType && [{
      type: itemType
    }, {
      type: nextType
    }];
    if (!types) types = [{
      type: itemType
    }, null];
    /* Change ends here */

    if (!canSplit(tr.doc, $from.pos, 2, types)) return false;
    if (dispatch) dispatch(tr.split($from.pos, 2, types).scrollIntoView());
    return true;
  };
}
/* eslint-enable max-len, no-plusplus, no-undef, eqeqeq */

function toggleBlockType (type, toggletype, attrs = {}) {
  return (state, dispatch, view) => {
    const isActive = nodeIsActive(state, type, attrs);

    if (isActive) {
      return setBlockType(toggletype)(state, dispatch, view);
    }

    return setBlockType(type, attrs)(state, dispatch, view);
  };
}

function isList(node, schema) {
  return node.type === schema.nodes.bullet_list || node.type === schema.nodes.ordered_list || node.type === schema.nodes.todo_list;
}

function toggleList(listType, itemType) {
  return (state, dispatch, view) => {
    const {
      schema,
      selection
    } = state;
    const {
      $from,
      $to
    } = selection;
    const range = $from.blockRange($to);

    if (!range) {
      return false;
    }

    const parentList = findParentNode(node => isList(node, schema))(selection);

    if (range.depth >= 1 && parentList && range.depth - parentList.depth <= 1) {
      if (parentList.node.type === listType) {
        return liftListItem(itemType)(state, dispatch, view);
      }

      if (isList(parentList.node, schema) && listType.validContent(parentList.node.content)) {
        const {
          tr
        } = state;
        tr.setNodeMarkup(parentList.pos, listType);

        if (dispatch) {
          dispatch(tr);
        }

        return false;
      }
    }

    return wrapInList(listType)(state, dispatch, view);
  };
}

function toggleWrap (type, attrs = {}) {
  return (state, dispatch, view) => {
    const isActive = nodeIsActive(state, type, attrs);

    if (isActive) {
      return lift(state, dispatch);
    }

    return wrapIn(type, attrs)(state, dispatch, view);
  };
}

function updateMark (type, attrs) {
  return (state, dispatch) => {
    const {
      tr,
      selection,
      doc
    } = state;
    const {
      ranges,
      empty
    } = selection;

    if (empty) {
      const {
        from,
        to
      } = getMarkRange(selection.$from, type);

      if (doc.rangeHasMark(from, to, type)) {
        tr.removeMark(from, to, type);
      }

      tr.addMark(from, to, type.create(attrs));
    } else {
      ranges.forEach(ref$1 => {
        const {
          $to,
          $from
        } = ref$1;

        if (doc.rangeHasMark($from.pos, $to.pos, type)) {
          tr.removeMark($from.pos, $to.pos, type);
        }

        tr.addMark($from.pos, $to.pos, type.create(attrs));
      });
    }

    return dispatch(tr);
  };
}

export { insertText, markInputRule, markPasteRule, nodeInputRule, pasteRule, removeMark, replaceText, setInlineBlockType, splitToDefaultListItem, toggleBlockType, toggleList, toggleWrap, updateMark };
