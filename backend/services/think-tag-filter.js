const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

function trailingPrefixLength(value, token) {
    const lower = value.toLowerCase();
    const maximum = Math.min(lower.length, token.length - 1);
    for (let length = maximum; length > 0; length -= 1) {
        if (lower.endsWith(token.slice(0, length))) return length;
    }
    return 0;
}

function createThinkTagFilter() {
    let buffer = "";
    let insideThink = false;

    function push(value) {
        buffer += String(value || "");
        let visible = "";

        while (buffer) {
            const lower = buffer.toLowerCase();
            if (insideThink) {
                const closeIndex = lower.indexOf(CLOSE_TAG);
                if (closeIndex >= 0) {
                    buffer = buffer.slice(closeIndex + CLOSE_TAG.length);
                    insideThink = false;
                    continue;
                }

                const retained = trailingPrefixLength(buffer, CLOSE_TAG);
                buffer = retained ? buffer.slice(-retained) : "";
                break;
            }

            const openIndex = lower.indexOf(OPEN_TAG);
            if (openIndex >= 0) {
                visible += buffer.slice(0, openIndex);
                buffer = buffer.slice(openIndex + OPEN_TAG.length);
                insideThink = true;
                continue;
            }

            const retained = trailingPrefixLength(buffer, OPEN_TAG);
            const visibleLength = buffer.length - retained;
            visible += buffer.slice(0, visibleLength);
            buffer = buffer.slice(visibleLength);
            break;
        }

        return visible;
    }

    function finish() {
        if (insideThink) {
            buffer = "";
            return "";
        }

        const visible = buffer;
        buffer = "";
        return visible;
    }

    return { push, finish };
}

function filterThinkTags(value) {
    const filter = createThinkTagFilter();
    return `${filter.push(value)}${filter.finish()}`;
}

module.exports = {
    createThinkTagFilter,
    filterThinkTags
};
