# Baseline границ слоёв — TODO-чеклист

Снимок замороженных нарушений `boundaries/dependencies` (источник — eslint-suppressions.json).
Каждый пункт — файл с кросс-фичевыми импортами; после стрелки — куда лезет и сколько раз.
Починил файл → `npx eslint . --prune-suppressions` уберёт его из baseline; обнови и этот файл.
Разбирать не обязательно подряд: boy-scout-правилом (трогаешь файл — почисти) либо пластами.

## Файлы (31, нарушений всего: 60)

- [ ] `src/features/admin/AchievementsAdmin.tsx` — 3 шт. → profile×3
- [ ] `src/features/admin/achievement-actions.ts` — 2 шт. → profile×2
- [ ] `src/features/admin/actions.ts` — 1 шт. → search×1
- [ ] `src/features/admin/collection-actions.ts` — 2 шт. → issues×1, library×1
- [ ] `src/features/catalogs/actions.ts` — 1 шт. → library×1
- [ ] `src/features/collections/queries.ts` — 2 шт. → catalogs×1, library×1
- [ ] `src/features/discussions/actions.ts` — 1 шт. → watch×1
- [ ] `src/features/follows/actions.ts` — 1 шт. → notifications×1
- [ ] `src/features/gardener/service.ts` — 6 шт. → library×2, moderation×1, notifications×2, watch×1
- [ ] `src/features/generation/actions.ts` — 4 шт. → library×4
- [ ] `src/features/generation/service.ts` — 1 шт. → library×1
- [ ] `src/features/git/actions.ts` — 1 шт. → collab×1
- [ ] `src/features/git/project.ts` — 1 шт. → library×1
- [ ] `src/features/issues/MilestonePicker.tsx` — 1 шт. → milestones×1
- [ ] `src/features/issues/actions.ts` — 5 шт. → collab×1, collab-store×1, notifications×1, watch×2
- [ ] `src/features/issues/label-actions.ts` — 1 шт. → collab×1
- [ ] `src/features/library/actions.ts` — 11 шт. → collab×1, collab-store×1, curation×1, git×4, moderation×1, notifications×1, watch×2
- [ ] `src/features/library/cover-actions.ts` — 1 шт. → collab×1
- [ ] `src/features/library/queries.ts` — 1 шт. → curation×1
- [ ] `src/features/milestones/actions.ts` — 1 шт. → collab×1
- [ ] `src/features/polls/actions.ts` — 1 шт. → library×1
- [ ] `src/features/profile/PinsPicker.tsx` — 1 шт. → library×1
- [ ] `src/features/profile/queries.ts` — 1 шт. → library×1
- [ ] `src/features/releases/actions.ts` — 2 шт. → collab×1, git×1
- [ ] `src/features/runs/actions.ts` — 2 шт. → collab-store×1, library×1
- [ ] `src/features/search/adapter.ts` — 1 шт. → library×1
- [ ] `src/features/settings/EmailSection.tsx` — 1 шт. → auth×1
- [ ] `src/features/settings/PasskeysSection.tsx` — 1 шт. → auth×1
- [ ] `src/features/settings/TwoFactorSection.tsx` — 1 шт. → auth×1
- [ ] `src/features/watch/actions.ts` — 1 шт. → curation×1
- [ ] `src/features/watch/queries.ts` — 1 шт. → curation×1
