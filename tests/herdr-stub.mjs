// Stand-in for the "herdr" module under node --test. Tests steer it through
// globalThis.__herdr: `exec` and `hc` handlers, the terminals and agents lists, and the
// shared store (an in-memory map, so state.js's update()/readState() work).
const H = (globalThis.__herdr ??= {});
export const resetHerdr = () => Object.assign(H, {
  store: new Map(), terminals: [], agents: [], focused: null, notices: [],
  exec: async () => ({ code: 127, stdout: "", stderr: "not found" }),
  hc: async () => ({ code: 0, stdout: "", stderr: "" }),
});
resetHerdr();
export const shared = (k) => H.store.get(k) ?? null;
export const setShared = (k, v) => { H.store.set(k, JSON.parse(JSON.stringify(v))); };
export const readTextFile = async () => "";
export const appHome = () => "/tmp/herdr-app-test";
export const home = () => "/tmp";
export const terminals = () => H.terminals;
export const agents = () => H.agents;
export const spaces = () => [];
export const focused = () => H.focused;
export const exec = (cmd, args, opts) => H.exec(cmd, args ?? [], opts);
export const hc = (args) => H.hc(args ?? []);
export const notify = (n) => { H.notices.push(n); };
export const run = () => null;
export const theme = () => ({});
export const layout = () => ({});
export const nextCommand = () => new Promise(() => {});
