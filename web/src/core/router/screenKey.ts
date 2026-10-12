/** The Easy bill's three steps keep one mounted form. Other pages retain their normal boundary. */
export const screenKey = (path: string) => /^\/e\/new(?:\/(?:items|customer))?\/?$/.test(path) ? "/e/new" : path;
