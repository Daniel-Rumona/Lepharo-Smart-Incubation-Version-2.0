/**
 * Review workspace: the list + detail building blocks shared by the
 * Applications and Participants pages. Importing from here also loads
 * workspace.css.
 */
import './workspace.css'

export { EntityAvatar, initialsOf } from './EntityAvatar'
export { ContactList, ContactRow, contactActions, type ContactAction } from './ContactList'
export { OwnershipCards, type OwnershipItem } from './OwnershipCards'
export { ChoiceFilter, FilterPanel, MAX_INLINE_CHOICES } from './ChoiceFilter'
export { SortSelect, type SortOption } from './SortSelect'
