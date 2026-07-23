import 'server-only'
// Ядро репутации переехало в shared/ai (им пользуется и совет — KPI-петля).
// Здесь только реэкспорт для существующих импортов из features.
export { gnomeReputation, gnomeRank, REP_MIN_GENS, type GnomeRep, type GnomeRank } from '@/shared/ai/gnome-reputation'
