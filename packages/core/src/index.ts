/**
 * overweave's core: definitions of kinds, and what contributors say of them,
 * layered. A contributor is the app's (an id, a priority, rights); it adds
 * definitions of its own and patches others' fields it has the rights for;
 * what several say of one leaf is layered — the highest priority wins, a
 * lower one shows again when it goes, every leaf knows who says it; what is
 * read always holds the kind's contract. Nothing else: who contributes,
 * when, what the definitions mean, how they are drawn or kept is the app's.
 */

export {
  type AnyKind,
  type ContractOf,
  type CreatableBy,
  type DeepReadonly,
  defineKind,
  type FieldPatch,
  type ItemPatch,
  type Kind,
  type KindContract,
  type ListRule,
  type NoFieldToPatch,
  type PatchableBy,
  type PatchOf,
  type Problem,
  type SpecOf,
  type Unset,
  type UnsetItem,
  unset,
  unsetItem,
} from './kinds.ts';
export {
  type AnySpec,
  type ApplyError,
  type ApplyResult,
  type Conflict,
  type ContributionOf,
  type Contributor,
  type ContributorOptions,
  createRegistry,
  type Definition,
  type Inspection,
  type KindsByName,
  type Leaf,
  type Operation,
  type Provenance,
  type Registry,
  type RegistryEvent,
} from './registry.ts';
