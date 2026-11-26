/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import type { ExtendedRecordMap } from 'notion-types'
import {
  blockIdFromElement,
  findBlockElement,
  findTextHost,
  isProtectedChild,
  mountInlineEditor,
  officialFromEditor,
  seedEditorHtml
} from '../src/editor/dom'
import { officialPlainText } from '../shared/richText'

const TEXT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CHILD_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function html(source: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = source.trim()
  const el = wrap.firstElementChild
  if (!(el instanceof HTMLElement)) throw new Error('expected element')
  return el
}

function recordMapWithTitle(title: Array<[string, Array<[string, ...string[]]>?]>): ExtendedRecordMap {
  return {
    block: {
      [UUID]: {
        role: 'reader',
        value: {
          id: UUID,
          type: 'text',
          properties: { title }
        }
      }
    }
  } as unknown as ExtendedRecordMap
}

describe('findTextHost', () => {
  it('targets heading title, not the hash link or anchor', () => {
    const block = html(`
      <h2 class="notion-h notion-h1 notion-block-${TEXT_ID}">
        <span>
          <div id="${TEXT_ID}" class="notion-header-anchor"></div>
          <a class="notion-hash-link" href="#${TEXT_ID}">#</a>
          <span class="notion-h-title">Heading</span>
        </span>
      </h2>
    `)
    const host = findTextHost(block)
    expect(host.className).toBe('notion-h-title')
    expect(host.textContent).toBe('Heading')
  })

  it('targets todo body, not the checkbox or nested children', () => {
    const block = html(`
      <div class="notion-to-do notion-block-${TEXT_ID}">
        <div class="notion-to-do-item">
          <div class="notion-property notion-property-checkbox"></div>
          <div class="notion-to-do-body">Todo text</div>
        </div>
        <div class="notion-to-do-children">
          <div class="notion-text notion-block-${CHILD_ID}">Nested</div>
        </div>
      </div>
    `)
    const host = findTextHost(block)
    expect(host.classList.contains('notion-to-do-body')).toBe(true)
    expect(host.textContent).toBe('Todo text')
  })

  it('targets the first list item, not a nested list', () => {
    const block = html(`
      <ul class="notion-list notion-list-disc notion-block-${TEXT_ID}">
        <li>Parent item</li>
        <ul class="notion-list notion-list-disc notion-block-${CHILD_ID}">
          <li>Child item</li>
        </ul>
      </ul>
    `)
    const host = findTextHost(block)
    expect(host.tagName).toBe('LI')
    expect(host.textContent).toBe('Parent item')
  })

  it('uses the paragraph block itself so child blocks stay in notion-text-children', () => {
    const block = html(`
      <div class="notion-text notion-block-${TEXT_ID}">
        <span>Paragraph</span>
        <div class="notion-text-children">
          <div class="notion-text notion-block-${CHILD_ID}">Child</div>
        </div>
      </div>
    `)
    expect(findTextHost(block)).toBe(block)
  })

  it('targets the quote title div, not nested block children', () => {
    const block = html(`
      <blockquote class="notion-quote notion-block-${TEXT_ID}">
        <div>Quoted</div>
        <div class="notion-text notion-block-${CHILD_ID}">Inside quote</div>
      </blockquote>
    `)
    const host = findTextHost(block)
    expect(host.tagName).toBe('DIV')
    expect(host.textContent).toBe('Quoted')
  })

  it('targets callout text, not the icon', () => {
    const block = html(`
      <div class="notion-callout notion-block-${TEXT_ID}">
        <div class="notion-page-icon">💡</div>
        <div class="notion-callout-text">
          Callout body
          <div class="notion-text notion-block-${CHILD_ID}">Nested</div>
        </div>
      </div>
    `)
    const host = findTextHost(block)
    expect(host.classList.contains('notion-callout-text')).toBe(true)
  })

  it('targets a toggle summary, not the details content', () => {
    const block = html(`
      <details class="notion-toggle notion-block-${TEXT_ID}">
        <summary>Toggle title</summary>
        <div>
          <div class="notion-text notion-block-${CHILD_ID}">Hidden child</div>
        </div>
      </details>
    `)
    const host = findTextHost(block)
    expect(host.tagName).toBe('SUMMARY')
    expect(host.textContent).toBe('Toggle title')
  })
})

describe('mountInlineEditor', () => {
  it('hides the original text so only one copy is visible and restores it on teardown', () => {
    const block = html(`
      <div class="notion-text notion-block-${TEXT_ID}">
        <span>Hello world</span>
        <div class="notion-text-children">
          <div class="notion-text notion-block-${CHILD_ID}">Child</div>
        </div>
      </div>
    `)
    const host = findTextHost(block)
    const session = mountInlineEditor(host, 'Hello world')
    const original = block.querySelector('span')
    expect(original?.getAttribute('data-sln-hidden')).toBe('1')
    expect(original?.style.display).toBe('none')
    expect(block.querySelectorAll('[data-sln-editor]')).toHaveLength(1)
    expect(session.editor.textContent).toBe('Hello world')
    expect(block.querySelector('.notion-text-children')?.textContent?.trim()).toBe('Child')
    expect(isProtectedChild(block.querySelector('.notion-text-children')!)).toBe(true)

    session.teardown()
    expect(block.querySelector('[data-sln-editor]')).toBeNull()
    expect(original?.getAttribute('data-sln-hidden')).toBeNull()
    expect(original?.style.display).toBe('')
    expect(original?.textContent).toBe('Hello world')
    expect(block.querySelector('.notion-text-children')?.textContent?.trim()).toBe('Child')
  })

  it('does not hide nested child blocks inside a callout text host', () => {
    const block = html(`
      <div class="notion-callout notion-block-${TEXT_ID}">
        <div class="notion-page-icon">💡</div>
        <div class="notion-callout-text">
          <span>Callout body</span>
          <div class="notion-text notion-block-${CHILD_ID}">Nested</div>
        </div>
      </div>
    `)
    const host = findTextHost(block)
    const session = mountInlineEditor(host, 'Callout body')
    const nested = block.querySelector(`.notion-block-${CHILD_ID}`)
    expect(nested).toBeTruthy()
    expect((nested as HTMLElement).style.display).not.toBe('none')
    expect(nested?.getAttribute('data-sln-hidden')).toBeNull()
    expect(session.editor.textContent).toBe('Callout body')
    session.teardown()
    expect(block.textContent).toContain('Callout body')
    expect(block.textContent).toContain('Nested')
  })
})

describe('block targeting and rich text', () => {
  it('reads a compact block id from a notion-block class', () => {
    const block = html(`<div class="notion-text notion-block-${TEXT_ID}"><span>Hi</span></div>`)
    expect(findBlockElement(block.firstElementChild)).toBe(block)
    expect(blockIdFromElement(block)).toBe(UUID)
  })

  it('round-trips official rich text through the editor HTML', () => {
    const rm = recordMapWithTitle([
      ['Hello ', [['b']]],
      ['world', [['i']]]
    ])
    const htmlStr = seedEditorHtml(rm, UUID)
    const editor = document.createElement('div')
    editor.innerHTML = htmlStr
    const official = officialFromEditor(editor)
    expect(officialPlainText(official)).toBe('Hello world')
    expect(official[0]?.annotations.bold).toBe(true)
    expect(official[1]?.annotations.italic).toBe(true)
  })
})
