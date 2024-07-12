import logger from '@/utils/logger';
import { config } from '@/config';
import undici, { Request, RequestInfo, RequestInit } from 'undici';
import proxy from '@/utils/proxy';
import { RateLimiterMemory, RateLimiterQueue } from 'rate-limiter-flexible';

const limiter = new RateLimiterMemory({
    points: 10,
    duration: 1,
    execEvenly: true,
});

const limiterQueue = new RateLimiterQueue(limiter, {
    maxQueueSize: 500,
});

const wrappedFetch: typeof undici.fetch = async (input: RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    const options: RequestInit = {};

    logger.debug(`Outgoing request: ${request.method} ${request.url}`);

    // ua
    if (!request.headers.get('user-agent')) {
        request.headers.set('user-agent', config.ua);
    }

    // accept
    if (!request.headers.get('accept')) {
        request.headers.set('accept', '*/*');
    }

    // referer
    if (!request.headers.get('referer')) {
        try {
            const urlHandler = new URL(request.url);
            request.headers.set('referer', urlHandler.origin);
        } catch {
            // ignore
        }
    }

    let isRetry = false;
    if (request.headers.get('x-retry')) {
        isRetry = true;
        request.headers.delete('x-retry');
    }

    // proxy
    if (!options.dispatcher && proxy.dispatcher && (proxy.proxyObj.strategy !== 'on_retry' || isRetry)) {
        const proxyRegex = new RegExp(proxy.proxyObj.url_regex);
        let urlHandler;
        try {
            urlHandler = new URL(request.url);
        } catch {
            // ignore
        }

        if (proxyRegex.test(request.url) && request.url.startsWith('http') && !(urlHandler && urlHandler.host === proxy.proxyUrlHandler?.host)) {
            options.dispatcher = proxy.dispatcher;
            logger.debug(`Proxying request: ${request.url}`);
        }
    }

    await limiterQueue.removeTokens(1);
    return undici.fetch(request, options);
};

export default wrappedFetch;