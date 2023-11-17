function compilePath(path, caseSensitive = false, end = true) {
    let compiledParams = [];
    let regexpSource =
        "^" +
        path
            .replace(/\/*\*?$/, "") // Ignore trailing / and /*, we'll handle it below
            .replace(/^\/*/, "/") // Make sure it has a leading /
            .replace(/[\\.*+^${}|()[\]]/g, "\\$&") // Escape special regex chars
            .replace(/\/:([\w-]+)(\?)?/g, (_, paramName, isOptional) => {
                compiledParams.push({ paramName, isOptional: isOptional != null });
                return isOptional ? "/?([^\\/]+)?" : "/([^\\/]+)";
            });

    if (path.endsWith("*")) {
        compiledParams.push({ paramName: "*" });
        regexpSource +=
            path === "*" || path === "/*"
                ? "(.*)$" // Already matched the initial /, just match the rest
                : "(?:\\/(.+)|\\/*)$"; // Don't include the / in params["*"]
    } else if (end) {
        // When matching to the end, ignore trailing slashes
        regexpSource += "\\/*$";
    } else if (path !== "" && path !== "/") {
        // If our path is non-empty and contains anything beyond an initial slash,
        // then we have _some_ form of path in our regex, so we should expect to
        // match only if we find the end of this path segment.  Look for an optional
        // non-captured trailing slash (to match a portion of the URL) or the end
        // of the path (if we've matched to the end).  We used to do this with a
        // word boundary but that gives false positives on routes like
        // /user-preferences since `-` counts as a word boundary.
        regexpSource += "(?:(?=\\/|$))";
    } else {
        // Nothing to match for "" or "/"
    }

    let matcher = new RegExp(regexpSource, caseSensitive ? undefined : "i");

    return new Route(matcher, compiledParams);
}

class Route {
    #matcher;
    #compiledParams;

    constructor(matcher, compiledParams) {
        this.#matcher = matcher;
        this.#compiledParams = compiledParams;
    }

    matchRoute(pathname) {
        let match = pathname.match(this.#matcher);
        if (!match) {
            return null;
        }

        const matchedPathname = match[0];
        let pathnameBase = matchedPathname.replace(/(.)\/+$/, "$1");
        let captureGroups = match.slice(1);
        let params = this.#compiledParams.reduce((memo, { paramName, isOptional }, index) => {
            // We need to compute the pathnameBase here using the raw splat value
            // instead of using params["*"] later because it will be decoded then
            if (paramName === "*") {
                let splatValue = captureGroups[index] || "";
                pathnameBase = matchedPathname
                    .slice(0, matchedPathname.length - splatValue.length)
                    .replace(/(.)\/+$/, "$1");
            }

            const value = captureGroups[index];
            if (isOptional && !value) {
                memo[paramName] = undefined;
            } else {
                memo[paramName] = (value || "").replace(/%2F/g, "/");
            }
            return memo;
        }, {});

        return {
            params,
            pathname: matchedPathname,
            pathnameBase,
        };
    }
}

export { compilePath };
