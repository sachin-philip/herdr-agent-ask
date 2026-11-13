// Stand-in for gpui-kit and gpui-base: every builder returns a chainable no-op, so the panel
// module loads and its non-rendering methods can run under node --test.
const chain = () => new Proxy(() => chain(), { get: (_t, k) => (k === "then" ? undefined : () => chain()) });
export class View {}
export const div = () => chain(), svg = () => chain(), image = () => chain(), v_flex = () => chain(), h_flex = () => chain();
export const Input = { new: () => chain() };
export const InputState = { new: () => ({ on() {}, value: () => "", set_value() {}, focus() {} }) };
export const Textarea = { new: () => chain() };
export const TextareaState = { new: () => ({ on() {}, value: () => "", set_value() {}, set_auto_grow() {}, focus() {} }) };
