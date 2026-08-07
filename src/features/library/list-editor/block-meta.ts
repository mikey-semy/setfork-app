import { BarChart3, Footprints, GraduationCap, Image as ImageIcon, Paperclip, ShoppingCart, Text as TextIcon, Video as VideoIcon } from 'lucide-react'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { BLOCK_TYPES, type BlockType } from '../blocks'

/**
 * Как выглядит и как называется каждый тип блока — ОДИН справочник на редактор.
 *
 * Живёт отдельно от компонентов: им пользуются и радиальный инсертер, и шапка
 * карточки, и слэш-меню, а справочник внутри компонента заставлял бы каждого нового
 * потребителя тащить за собой этот компонент (и ломал `only-export-components`).
 */
export const BLOCK_ICON: Record<BlockType, typeof Footprints> = {
  step: Footprints,
  text: TextIcon,
  image: ImageIcon,
  poll: BarChart3,
  video: VideoIcon,
  quiz: GraduationCap,
  file: Paperclip,
  product: ShoppingCart,
}

const BLOCK_LABEL: Record<BlockType, TKey> = {
  step: 'block.step',
  text: 'block.text',
  image: 'block.image',
  poll: 'block.poll',
  video: 'block.video',
  quiz: 'block.quiz',
  file: 'block.file',
  product: 'block.product',
}

export const blockLabel = (type: BlockType, lang: Lang): string => t(BLOCK_LABEL[type], lang)

/**
 * Строка после «/» в пустом блоке — запрос слэш-меню; null — меню закрыто.
 *
 * Меню живёт только в блоке, который НАЧИНАЕТСЯ со слэша: «см. /etc/hosts» посреди
 * текста — это просто текст. Перенос строки тоже закрывает: человек уже пишет абзац.
 */
export function slashQuery(value: string): string | null {
  if (!value.startsWith('/')) return null
  const query = value.slice(1)
  return query.includes('\n') ? null : query
}

/**
 * Типы блоков, подходящие под запрос. Совпадение ищем и по подписи на языке
 * интерфейса, и по английскому коду типа: раскладку ради «/картинка» переключают не
 * все, а «/image» набирается не глядя.
 */
export function matchBlockTypes(query: string, lang: Lang): BlockType[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...BLOCK_TYPES]
  return BLOCK_TYPES.filter((type) => blockLabel(type, lang).toLowerCase().startsWith(q) || type.startsWith(q))
}
