export function controls(document, window) {
  const all = (selector, root = document) =>
    [...root.querySelectorAll(selector)].filter(
      (el) => !el.closest('[aria-hidden="true"],[hidden]'),
    )
  const one = (selector) => all(selector)[0]
  const text = (selector, value) => all(selector).find((el) => el.textContent.trim() === value)
  const label = (value) => one('[aria-label="' + value + '"]')

  async function until(read, description, timeout = 3500) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const value = read()
      if (value) return value
      await new Promise((r) => window.setTimeout(r, 20))
    }
    throw new Error(description + '; visible: ' + document.body.innerText.slice(0, 1200))
  }

  const click = async (get, description) => {
    const el = await until(() => {
      const el = get()
      return el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el
    }, description)
    el.click()
  }

  const press = (el, key) =>
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  const type = (el, value) => {
    const type = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement
    Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }

  const button = (value) => click(() => text('button', value), value)
  const tab = (value) => click(() => text('[role=tab]', value), value)
  const action = (value) => click(() => label(value), value)

  function check(ok, message) {
    if (!ok) throw new Error(message)
  }

  return {
    document,
    window,
    one,
    all,
    text,
    label,
    until,
    click,
    press,
    type,
    button,
    tab,
    action,
    check,
  }
}
