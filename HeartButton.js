// NAME: HeartButton
// AUTHOR: pauburk
// DESCRIPTION: Adds back the old heart button which adds/removes from the Liked Songs playlist and shows a half-heart if a duplicate version is already liked.
// Slightly modified & optimized version of https://github.com/Maskowh/spicetify-old-like-button-extension


let likedTracksIdsISRCs = new Map();                                // ids/isrcs of all liked tracks, to check if we should display the heart icon or not. 
let likedTracksISRCs = new Set(likedTracksIdsISRCs.values());       // isrcs of all liked tracks, to check if we should display the half-heart icon or not

var proxyLikedTracksIdsISRCs;                                       // proxy for likedTracksIds, to trigger an event on add/delete

var likedTracksChangeEvent = new CustomEvent('likedTracksChange');



// --- Proxy Creation ---
function createProxyForLikedTracksIdsISRCs() {
    return new Proxy(likedTracksIdsISRCs, {
        get: function (target, property, receiver) {
            if (["set", "delete"].includes(property) && typeof target[property] === "function") {
                return function (...args) {
                    const result = target[property].apply(target, args);
                    likedTracksISRCs = new Set(likedTracksIdsISRCs.values());
                    document.dispatchEvent(likedTracksChangeEvent);
                    return result;
                };
            }
            return Reflect.get(target, property, receiver);
        }
    });
}

function updateLikedTracksIdsISRCs(newMap) {
    likedTracksIdsISRCs.clear();
    for (const [k, v] of newMap.entries()) {
        likedTracksIdsISRCs.set(k, v);
    }
    likedTracksISRCs = new Set(likedTracksIdsISRCs.values());
}

function getLikedTracksIdsWithUnknownISRCs(likedTracksIds) {
    const newLikedTracksIdsISRCs = new Map();
    const likedTracksIdsWithUnknownISRCs = [];
    likedTracksIds.forEach(trackId => {
        const trackIsrc = localStorage.getItem("maskowh-oldlike-" + trackId)
        if (trackIsrc != null) {
            newLikedTracksIdsISRCs.set(trackId, trackIsrc)
        } else if (!trackId.startsWith("spotify:local:")) {
            likedTracksIdsWithUnknownISRCs.push(trackId);
        }
    });
    return { newLikedTracksIdsISRCs, likedTracksIdsWithUnknownISRCs };
}

async function fetchISRCsForUnknownTracks(likedTracksIdsWithUnknownISRCs, newLikedTracksIdsISRCs) {
    let promises = [];
    for (let i = 0; i < likedTracksIdsWithUnknownISRCs.length; i += 50) {
        let batch = likedTracksIdsWithUnknownISRCs.slice(i, i + 50);
        console.info("Requesting ISRCs for the following liked tracks: " + batch);
        promises.push(
            Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/tracks?ids=${batch.join(",")}`).then(response => {
                response.tracks.forEach(track => {
                    newLikedTracksIdsISRCs.set(track.id, track.external_ids.isrc);
                    localStorage.setItem("maskowh-oldlike-" + track.id, track.external_ids.isrc);
                });
            })
        );
    }
    await Promise.all(promises);
}

async function initiateLikedSongs() {
    if (!Spicetify.CosmosAsync) {
        setTimeout(initiateLikedSongs, 10);
        return;
    }
    let likedTracksItems = await Spicetify.CosmosAsync.get("sp://core-collection/unstable/@/list/tracks/all?responseFormat=protobufJson");
    let likedTracksIds = likedTracksItems.item.map(item => item.trackMetadata.link.replace("spotify:track:", ""));

    const { newLikedTracksIdsISRCs, likedTracksIdsWithUnknownISRCs } = getLikedTracksIdsWithUnknownISRCs(likedTracksIds);
    await fetchISRCsForUnknownTracks(likedTracksIdsWithUnknownISRCs, newLikedTracksIdsISRCs);
    updateLikedTracksIdsISRCs(newLikedTracksIdsISRCs);

    document.dispatchEvent(likedTracksChangeEvent);
    setTimeout(initiateLikedSongs, 30000);
}

if (!proxyLikedTracksIdsISRCs) {
    proxyLikedTracksIdsISRCs = createProxyForLikedTracksIdsISRCs();
}
initiateLikedSongs();

(function quickLike() {
    if (
        !(
            Spicetify.React &&
            Spicetify.ReactDOM &&
            Spicetify.SVGIcons &&
            Spicetify.showNotification &&
            Spicetify.Platform.PlayerAPI &&
            Spicetify.Tippy &&
            Spicetify.TippyProps &&
            Spicetify.CosmosAsync &&
            Spicetify.Player &&
            Spicetify.Player.data
        )
    ) {
        setTimeout(quickLike, 10);
        return;
    }


    // --- ISRC Cache and Debounce Utility (outside component, not recreated per render) ---
    const isrcCache = {};
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // --- Global Event Handler for likedTracksChange ---
    const likedTracksChangeHandlers = new Set();
    if (!window._heartButtonGlobalListener) {
        document.addEventListener('likedTracksChange', () => {
            likedTracksChangeHandlers.forEach((handler) => handler());
        });
        window._heartButtonGlobalListener = true;
    }

    // --- LikeButton Component ---

    function getISRC(trackId) {
        if (isrcCache[trackId] !== undefined) return isrcCache[trackId];
        const val = localStorage.getItem("maskowh-oldlike-" + trackId);
        isrcCache[trackId] = val;
        return val;
    }

    function useLikedTrackStates(trackId, isrc) {
        const [isLiked, setIsLiked] = Spicetify.React.useState(() => likedTracksIdsISRCs.has(trackId));
        const [hasISRCLiked, setHasISRCLiked] = Spicetify.React.useState(() => likedTracksISRCs.has(isrc));
        Spicetify.React.useEffect(() => {
            // Debounced state update for likedTracksChange
            const updateStates = debounce(() => {
                setIsLiked(likedTracksIdsISRCs.has(trackId));
                setHasISRCLiked(likedTracksISRCs.has(isrc));
            }, 50);
            likedTracksChangeHandlers.add(updateStates);
            return () => {
                likedTracksChangeHandlers.delete(updateStates);
            };
        }, [trackId, isrc]);
        return [isLiked, setIsLiked, hasISRCLiked, setHasISRCLiked];
    }

    function useTippy(buttonRef, isLiked, hasISRCLiked) {
        Spicetify.React.useEffect(() => {
            let tippyInstance;
            if (buttonRef.current) {
                tippyInstance = Spicetify.Tippy(buttonRef.current, {
                    ...Spicetify.TippyProps,
                    hideOnClick: true,
                    content: isLiked ? "Remove from Liked Songs" : hasISRCLiked ? "Duplicate record already in Liked Songs" : "Add to Liked Songs"
                });
            }
            return () => {
                if (tippyInstance) tippyInstance.destroy();
            };
        }, [isLiked, hasISRCLiked, buttonRef]);
    }

    function useISRCInit(isLiked, isrc, trackId, setISRC, setHasISRCLiked) {
        Spicetify.React.useEffect(() => {
            let cancelled = false;
            async function initISRC() {
                try {
                    if (isrc == null) {
                        let track = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/tracks/${trackId}`);
                        if (cancelled) return;
                        setISRC(track.external_ids.isrc);
                        isrcCache[track.id] = track.external_ids.isrc;
                        localStorage.setItem("maskowh-oldlike-" + track.id, track.external_ids.isrc);
                        setHasISRCLiked(likedTracksISRCs.has(track.external_ids.isrc));
                    } else {
                        setHasISRCLiked(likedTracksISRCs.has(isrc));
                    }
                } catch (error) {
                    console.error('Error fetching data:', error);
                }
            }
            initISRC();
            return () => { cancelled = true; };
        }, [isLiked, isrc, trackId]);
    }

    const LikeButton = Spicetify.React.memo(function LikeButton({ uri, classList }) {
        const trackId = Spicetify.React.useMemo(() => uri.replace("spotify:track:", ""), [uri]);
        const [isrc, setISRC] = Spicetify.React.useState(() => getISRC(trackId));
        const [isLiked, setIsLiked, hasISRCLiked, setHasISRCLiked] = useLikedTrackStates(trackId, isrc);
        const [isHovered, setIsHovered] = Spicetify.React.useState(false);
        const buttonRef = Spicetify.React.useRef(null);

        useTippy(buttonRef, isLiked, hasISRCLiked);
        useISRCInit(isLiked, isrc, trackId, setISRC, setHasISRCLiked);

        const handleClick = Spicetify.React.useCallback(async () => {
            Spicetify.showNotification(isLiked ? "Removed from Liked Songs" : "Added to Liked Songs");
            if (isLiked) {
                try {
                    await Spicetify.CosmosAsync.del(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`);
                } catch (error) {
                    if (!(error instanceof SyntaxError && error.message === 'Unexpected end of JSON input')) {
                        console.error(error);
                    }
                }
                proxyLikedTracksIdsISRCs.delete(trackId);
            } else {
                try {
                    await Spicetify.CosmosAsync.put(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`);
                } catch (error) {
                    if (!(error instanceof SyntaxError && error.message === 'Unexpected end of JSON input')) {
                        console.error(error);
                    }
                }
                if (isrc === "") {
                    console.error("Track without isrc set. Shouldn't happen")
                } else {
                    proxyLikedTracksIdsISRCs.set(trackId, isrc);
                }
            }
        }, [isLiked, isrc, trackId]);

        const handleMouseOver = Spicetify.React.useCallback(() => setIsHovered(true), []);
        const handleMouseOut = Spicetify.React.useCallback(() => setIsHovered(false), []);

        return Spicetify.React.createElement(
            "button",
            {
                ref: buttonRef,
                className: classList,
                "aria-checked": isLiked || hasISRCLiked,
                onClick: handleClick,
                onMouseOver: handleMouseOver,
                onMouseOut: handleMouseOut,
                style: {
                    marginRight: "12px",
                    opacity: (isLiked || hasISRCLiked) ? "1" : undefined
                }
            },
            Spicetify.React.createElement(
                "span",
                { className: "Wrapper-sm-only Wrapper-small-only" },
                Spicetify.React.createElement("svg", {
                    role: "img",
                    height: "16",
                    width: "16",
                    viewBox: "0 0 24 24",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    className: (isLiked || hasISRCLiked) ? "Svg-img-icon-small-textBrightAccent" : "Svg-img-icon-small",
                    style: {
                        fill: (isLiked || hasISRCLiked) ? "var(--text-bright-accent)" : "var(--text-subdued)"
                    },
                    dangerouslySetInnerHTML: {
                        __html: isLiked
                            ? `<path d="M12 4.248c-3.148-5.402-12-3.825-12 2.944 0 4.661 5.571 9.427 12 15.808 6.43-6.381 12-11.147 12-15.808 0-6.792-8.875-8.306-12-2.944z"/></path>`
                            : (hasISRCLiked
                                ? `<path d="M12 23 12 20.192c-5.258-5.15-10-9.558-10-13C2 4.516 3.965 2.999 6.28 3c3.236.001 4.973 3.491 5.72 5.031V20.192c0 .4-.07.814 0 2.808C18.43 16.619 24 12 24 7.192 24 3.181 20.903 1.01 17.726 1.01 15.521 1.01 13.279 2.053 12 4.248 10.715 2.042 8.478 1 6.281 1 3.098 1 0 3.187 0 7.192 0 11.853 5.57 16.619 12 23Z"/></path>`
                                : `<path d="M19.5 10c-2.483 0-4.5 2.015-4.5 4.5s2.017 4.5 4.5 4.5 4.5-2.015 4.5-4.5-2.017-4.5-4.5-4.5zm2.5 5h-2v2h-1v-2h-2v-1h2v-2h1v2h2v1zm-6.527 4.593c-1.108 1.086-2.275 2.219-3.473 3.407-6.43-6.381-12-11.147-12-15.808 0-4.005 3.098-6.192 6.281-6.192 2.197 0 4.434 1.042 5.719 3.248 1.279-2.195 3.521-3.238 5.726-3.238 3.177 0 6.274 2.171 6.274 6.182 0 .746-.156 1.496-.423 2.253-.527-.427-1.124-.768-1.769-1.014.122-.425.192-.839.192-1.239 0-2.873-2.216-4.182-4.274-4.182-3.257 0-4.976 3.475-5.726 5.021-.747-1.54-2.484-5.03-5.72-5.031-2.315-.001-4.28 1.516-4.28 4.192 0 3.442 4.742 7.85 10 13l2.109-2.064c.376.557.839 1.048 1.364 1.465z"></path>`)
                    }
                })
            )
        );
    });


    // --- Paybar Button Insertion ---
    function waitForWidgetMounted() {
        const nowPlayingWidget = document.querySelector(".main-nowPlayingWidget-nowPlaying");
        const entryPoint = document.querySelector(".main-nowPlayingWidget-nowPlaying [data-encore-id='buttonTertiary']");
        if (!(nowPlayingWidget && entryPoint)) {
            setTimeout(waitForWidgetMounted, 300);
            return;
        }
        const likeButtonWrapper = document.createElement("div");
        likeButtonWrapper.className = "likeControl-wrapper";
        renderLikeButton(likeButtonWrapper);
    }

    function attachPaybarObserver() {
        const leftPlayer = document.querySelector(".main-nowPlayingBar-left");
        if (!leftPlayer) {
            setTimeout(attachPaybarObserver, 300);
            return;
        }
        waitForWidgetMounted();
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.removedNodes.length > 0) {
                    const removedNodes = Array.from(mutation.removedNodes);
                    const isNowPlayingRemoved = removedNodes.some(node => node.classList && node.classList.contains("main-nowPlayingWidget-nowPlaying"));
                    if (isNowPlayingRemoved) {
                        waitForWidgetMounted();
                    }
                }
            });
        });
        observer.observe(leftPlayer, { childList: true });
    }

    function renderLikeButton(container) {
        const uri = Spicetify.Player.data?.item?.uri || "";
        const entryPoint = document.querySelector(".main-nowPlayingWidget-nowPlaying [data-encore-id='buttonTertiary']");
        try {
            entryPoint.parentNode.parentNode.insertBefore(container, entryPoint.nextSibling);
        } catch (error) {
            try {
                entryPoint.parentNode.parentNode.parentNode.insertBefore(container, entryPoint.nextSibling);
            } catch (altError) {
                console.error("Failed to insert like button", error, altError);
                return;
            }
        }
        Spicetify.ReactDOM.render(
            Spicetify.React.createElement(LikeButton, {
                uri: uri,
                key: uri,
                classList: entryPoint.classList
            }),
            container
        );
        container.firstChild.style.marginRight = "0px";
    }

    function onSongChange() {
        const container = document.querySelector(".likeControl-wrapper");
        if (container) {
            renderLikeButton(container);
        }
    }

    // --- Main View Button Insertion ---
    function findVal(object, key, max = 10) {
        if (object[key] !== undefined || !max) {
            return object[key];
        }
        for (const k in object) {
            if (object[k] && typeof object[k] === "object") {
                const value = findVal(object[k], key, --max);
                if (value !== undefined) {
                    return value;
                }
            }
        }
        return undefined;
    }

    function handleMutation(mutationList) {
        mutationList.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                const nodeMatch =
                    node.attributes?.role?.value === "row"
                        ? node.firstChild?.lastChild
                        : node.firstChild?.attributes?.role?.value === "row"
                            ? node.firstChild?.firstChild.lastChild
                            : null;
                if (nodeMatch) {
                    const entryPoint = nodeMatch.querySelector(":scope > button:not(:last-child):has([data-encore-id])");
                    if (entryPoint) {
                        const reactPropsKey = Object.keys(node).find(key => key.startsWith("__reactProps$"));
                        const uri = findVal(node[reactPropsKey], "uri");
                        const likeButtonWrapper = document.createElement("div");
                        likeButtonWrapper.className = "likeControl-wrapper";
                        likeButtonWrapper.style.display = "contents";
                        likeButtonWrapper.style.marginRight = 0;
                        const likeButtonElement = nodeMatch.insertBefore(likeButtonWrapper, entryPoint);
                        Spicetify.ReactDOM.render(
                            Spicetify.React.createElement(LikeButton, {
                                uri,
                                classList: entryPoint.classList
                            }),
                            likeButtonElement
                        );
                    }
                }
            });
        });
    }

    function attachMainViewObserver() {
        const observer = new MutationObserver(handleMutation);
        observer.observe(document, {
            subtree: true,
            childList: true
        });
    }

    // --- Attach Observers and Listeners ---
    attachPaybarObserver();
    Spicetify.Player.addEventListener("songchange", onSongChange);
    attachMainViewObserver();
})();