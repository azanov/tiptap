import { h } from 'vue'

export default {
  props: {
    editor: {
      default: null,
      type: Object,
    },
  },

  watch: {
    editor: {
      immediate: true,
      handler(editor) {
        if (editor && editor.element) {
          this.$nextTick(() => {
            this.$el.appendChild(editor.element.firstChild)
            editor.setParentComponent(this)
          })
        }
      },
    },
  },

  render() {
    return h('div')
  },

  beforeUnmount() {
    this.editor.element = this.$el
  },
}
