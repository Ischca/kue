// Checked by `tsc` (pnpm typecheck), not vitest: apps meet these rules as JSX errors.
// Each rejected element has an accepted counterpart built from the same values.
import { Kue } from "../src/Kue";
import type { KueCloudConfig, KueDestination, KueGroupSubmitHandler, KueSubmitHandler } from "../src/types";

const cloud: KueCloudConfig = { apiBaseUrl: "https://kue.example.test", projectKey: "pk_test_example" };
const save: KueSubmitHandler = () => undefined;
const saveGroup: KueGroupSubmitHandler = async () => undefined;
declare const maybeCloud: KueCloudConfig | undefined;

export const accepted = [
  <Kue cloud={cloud} />,
  <Kue onSubmit={save} submitLabel="保存" />,
  <Kue cloud={cloud} onSubmit={save} onSubmitGroup={saveGroup} submitLabel="保存" />,
  <Kue cloud={cloud} onSubmitGroup={saveGroup} submitLabel="まとめて保存" />,
];

export const rejected = [
  // @ts-expect-error One of cloud or onSubmit is required.
  <Kue />,
  // @ts-expect-error A custom handler names its own action.
  <Kue onSubmit={save} />,
  // @ts-expect-error A group handler names its own action as well.
  <Kue cloud={cloud} onSubmitGroup={saveGroup} />,
  // @ts-expect-error KUE Cloud always creates an Issue, so it takes no label.
  <Kue cloud={cloud} submitLabel="保存" />,
  // @ts-expect-error The screens exist in Japanese and English only.
  <Kue cloud={cloud} locale="fr" />,
];

export const languages = [<Kue cloud={cloud} locale="en" />, <Kue cloud={cloud} locale="ja" />];

// A destination chosen at runtime is one value, so the label travels with the handler.
const chosen: KueDestination = maybeCloud ? { cloud: maybeCloud } : { onSubmit: save, submitLabel: "保存" };
export const conditional = <Kue {...chosen} />;
// @ts-expect-error Separately optional props cannot show that a handler comes with a label.
export const unproven = <Kue cloud={maybeCloud} onSubmit={maybeCloud ? undefined : save} />;
