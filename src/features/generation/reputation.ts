import 'server-only'
// Ядро репутации переехало в shared/ai (им пользуется и совет — KPI-петля).
// Здесь только реэкспорт для существующих импортов из features.
export { gnomeReputation, REP_MIN_GENS, type GnomeRep } from '@/shared/ai/gnome-reputation'
