// Design-sync bundle entry — hand-authored so the converter bundles ONLY the
// curated design-system surface (18 pieces), not the whole app. esbuild
// resolves the `@/` alias from tsconfig (cfg.tsconfig) and externalizes
// react / react-dom to window.React / window.ReactDOM.
//
// The CSS side-effect imports below are what carry the design language into
// the bundle: esbuild follows their @import closure and emits one
// _ds_bundle.css, which styles.css @imports — the only path component CSS
// reaches designs built with the DS.
//
//   global.css            → @imports tokens.css + components.css + oauth
//   np-canonical-plus.css → PickerKey  (.cnp-picker-key)
//   np-v8.css             → EntityCard (.home-pcard*)
//   skeu-hero.css         → SkeuHero   (.skeu-hero*)
//   (searchable-dropdown.css is imported by SearchableDropdown itself)
import "@/styles/global.css";
import "@/styles/np-canonical-plus.css";
import "@/styles/np-v8.css";
import "@/styles/skeu-hero.css";

// dfds primitives
export { CustomSelect, type SelectOption } from "@/components/dfds/CustomSelect";
export { ColorPickerPopover } from "@/components/dfds/ColorPickerPopover";
export { ModalClose } from "@/components/dfds/ModalClose";
export { CardMenuButton } from "@/components/dfds/CardMenuButton";

// modal
export { DfModal, type DfModalProps } from "@/components/DfModal";

// controls
export { SkeuToggle } from "@/components/SkeuToggle";
export { ThemeToggle, type ThemeToggleProps } from "@/components/ThemeToggle";
export { TactileBtn, TactileIconBtn } from "@/components/Tactile";
export { PickerKey, type PickerKeyProps } from "@/components/PickerKey";
export { SearchableDropdown } from "@/components/SearchableDropdown";

// surfaces / cards
export { EntityCard, type EntityCardProps } from "@/components/EntityCard";
export { SkeuHero, type SkeuHeroProps } from "@/components/SkeuHero";
export { CharacterCover } from "@/components/CharacterCover";

// feedback / identity
export { DfLoader, type DfLoaderProps } from "@/components/DfLoader";
export { Logo } from "@/components/Logo";
export { AskUserQuestion, type AskUserQuestionProps } from "@/components/AskUserQuestion";
export { PreviewSandboxBadge } from "@/components/PreviewSandboxBadge";

// visual showcase — verb shaders
export {
  VerbShader,
  ShaderScan,
  ShaderPolish,
  ShaderAurora,
  ShaderSparkle,
  ShaderGlitch,
} from "@/components/VerbShaders";
