export function pushToPodlove(episodeId: Number, user: string, appId: string, url: string, text: string) {

    // check if episode exist
    const podloveUrlEpispde = url + '/wp-json/podlove/v2/episodes/' + episodeId.toString();
    fetch(podloveUrlEpispde, {
        method: "GET",
        headers: {
            'Content-type': 'application/json;charset=UTF-8',
            'Authorization': `Basic ${btoa(`${user}:${appId}`)}`
        }
    })
        .then(response => {
            // export the vtt to the podlove publisher
            if (response.status === 200) {
                const podloveUrlTranscript = url + '/wp-json/podlove/v2/transcripts/' + episodeId.toString();
                const podloveData = {
                    type: "vtt",
                    content: text
                }
                fetch(podloveUrlTranscript, {
                    method: "POST",
                    body: JSON.stringify(podloveData),
                    headers: {
                        'Content-type': 'application/json;charset=UTF-8',
                        'Authorization': `Basic ${btoa(`${user}:${appId}`)}`
                    }
                })
                    .then(response => response.json())
                    .catch(err => console.error(err));
            }
        })
        .catch(err => console.error(err))
}

export function isEpisodeExistAtPodlove(episodeId: Number, url: string) {
    const podloveUrlEpispde = url + '/wp-json/podlove/v2/episodes/' + episodeId.toString();
    fetch(podloveUrlEpispde, {
        method: "GET"
    })
        .then(response => {
            // export the vtt to the podlove publisher
            if (response.status === 200) {
                return true;
            }
            else {
                return false;
            }
        })
        .catch(err => {
            console.error(err);
            return false;
        })
}