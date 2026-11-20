// Resolves "herdr", "gpui-kit" and "gpui-base" to stubs; registered by tests/register.mjs.
const STUBS = { herdr: "./herdr-stub.mjs", "gpui-kit": "./gpui-stub.mjs", "gpui-base": "./gpui-stub.mjs" };
export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: new URL(STUBS[specifier], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
