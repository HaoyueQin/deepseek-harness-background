/** Locale dictionaries for the background plugin. */

import type { BackgroundCardLocaleKey } from './types.ts'

/** Dictionary of the namespace this plugin owns. */
export type BackgroundCardDict = Record<BackgroundCardLocaleKey, string>

/** Chinese copy. */
export const zh: BackgroundCardDict = {
  'background.title': '自定义背景',
  'background.description': '为整个应用界面设置背景图片，可调不透明度、遮罩、面板透明与毛玻璃模糊',
  'background.upload': '上传图片',
  'background.uploading': '上传中…',
  'background.uploadMinetypes': '支持 JPG / PNG / WebP / GIF',
  'background.urlPlaceholder': '或粘贴图片 http(s) 链接后回车',
  'background.applyUrl': '应用链接',
  'background.enabled': '背景已启用',
  'background.source': '图片',
  'background.effects': '效果',
  'background.noPreview': '上传图片或粘贴链接后，此处实时预览效果',
  'background.previewGlass': '毛玻璃',
  'background.opacity': '不透明度',
  'background.scrim': '遮罩',
  'background.panelOpacity': '面板不透明度',
  'background.blur': '毛玻璃模糊',
  'background.wallpaperBlur': '壁纸模糊',
  'background.fit': '填充方式',
  'background.cover': '铺满',
  'background.contain': '完整',
  'background.clear': '清除背景',
  'background.uploadFailed': '上传失败，请重试',
  'background.saveFailed': '保存失败，请重试',
}

/** English copy. */
export const en: BackgroundCardDict = {
  'background.title': 'Custom Background',
  'background.description': 'Set a background image behind the whole app surface with adjustable opacity, scrim, panel transparency and glass blur',
  'background.upload': 'Upload image',
  'background.uploading': 'Uploading…',
  'background.uploadMinetypes': 'JPG / PNG / WebP / GIF',
  'background.urlPlaceholder': 'Or paste an image http(s) link and press Enter',
  'background.applyUrl': 'Apply URL',
  'background.enabled': 'Background on',
  'background.source': 'Image',
  'background.effects': 'Effects',
  'background.noPreview': 'Upload an image or paste a link to preview live here',
  'background.previewGlass': 'Glass',
  'background.opacity': 'Opacity',
  'background.scrim': 'Scrim',
  'background.panelOpacity': 'Panel opacity',
  'background.blur': 'Glass blur',
  'background.wallpaperBlur': 'Wallpaper blur',
  'background.fit': 'Fit',
  'background.cover': 'Cover',
  'background.contain': 'Contain',
  'background.clear': 'Clear background',
  'background.uploadFailed': 'Upload failed, try again',
  'background.saveFailed': 'Save failed, try again',
}
