/**
 * Static-asset URL imports that vite/client.d.ts does not predeclare.
 * Vite emits the file as a fingerprinted static asset and hands back its URL.
 */
declare module "*.glb?url" {
  const src: string;
  export default src;
}
