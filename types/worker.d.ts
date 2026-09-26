/// <reference types="node" />

// Next.js does not ship module declarations for `?worker` imports.
declare module '*?worker' {
  const workerConstructor: {
    new (options?: { name?: string; type?: WorkerType }): Worker;
  };
  export default workerConstructor;
}
