/** Locale dictionaries for the background plugin. */

import type { BackgroundCardLocaleKey } from './types.ts'

/** Dictionary of the namespace this plugin owns. */
export type BackgroundCardDict = Record<BackgroundCardLocaleKey, string>

/** Chinese copy. */
export const zh: BackgroundCardDict = {
  'background.title': '自定义背景',
  'background.description': '为整个应用界面设置背景图片（明/暗主题各一张），可调不透明度与遮罩强度',
  'background.entryHint': '点击打开背景图片设置',
  'background.enabled': '启用',
  'background.lightUrl': '浅色图片',
  'background.darkUrl': '深色图片',
  'background.opacity': '不透明度',
  'background.scrim': '遮罩强度',
  'background.fit': '填充方式',
  'background.cover': '铺满',
  'background.contain': '完整',
  'background.preview': '启用并填入图片后，这里实时预览背景效果',
  'background.unsaved': '有未保存修改',
  'background.save': '保存',
  'background.saving': '保存中…',
  'background.close': '关闭',
  'background.discard': '放弃修改',
  'background.readOnly': '当前文档只读，无法修改',
  'background.saveFailed': '保存失败，请重试',
  'background.resetAll': '全部重置',
}

/** English copy. */
export const en: BackgroundCardDict = {
  'background.title': 'Custom Background',
  'background.description': 'Set a background image behind the whole app surface (one per light/dark theme), with opacity and scrim controls',
  'background.entryHint': 'Open the background image settings',
  'background.enabled': 'Enabled',
  'background.lightUrl': 'Light image',
  'background.darkUrl': 'Dark image',
  'background.opacity': 'Opacity',
  'background.scrim': 'Scrim',
  'background.fit': 'Fit',
  'background.cover': 'Cover',
  'background.contain': 'Contain',
  'background.preview': 'Enable and set an image to preview the background here',
  'background.unsaved': 'Unsaved changes',
  'background.save': 'Save',
  'background.saving': 'Saving…',
  'background.close': 'Close',
  'background.discard': 'Discard',
  'background.readOnly': 'This document is read-only',
  'background.saveFailed': 'Save failed, try again',
  'background.resetAll': 'Reset all',
}
