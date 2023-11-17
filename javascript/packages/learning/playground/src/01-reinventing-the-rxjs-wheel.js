const testFetch = (url, { signal }) =>
    new Promise((resolve, reject) => {
        console.log(`start fetch to ${url}`);
        const timerId = setTimeout(resolve, 100);
        signal.onabort = () => {
            clearTimeout(timerId);
            reject(new Error(`fetch to ${url} was aborted`));
        };
    });

/**
 * we need to have fetch with retry and cancellation
 */
const appFetch = async (retryNumber = 0, url, ac) => {
    try {
        return await testFetch(url, { signal: ac.signal });
    } catch (e) {
        if (!ac.signal.aborted && retryNumber > 0) {
            return appFetch(url, ac, retryNumber - 1);
        }

        throw e;
    }
};

const appFetchDefault = appFetch.bind(null, 5);

const specialService = async () => {
    const ac = new AbortController();

    try {
        const fetch1 = appFetchDefault("/ameba1", ac);

        ac.abort();

        await fetch1;
    } catch (e) {
        console.error("specialService error");
        console.error(e);
    }
};

specialService();
