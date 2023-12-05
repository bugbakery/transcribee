export function pushToPodlove(
  episodeId: number,
  user: string,
  appId: string,
  url: string,
  text: string,
) {
  // check if episode exist
  const podloveUrlEpispde = url + '/wp-json/podlove/v2/episodes/' + episodeId.toString();
  fetch(podloveUrlEpispde, {
    method: 'GET',
    headers: {
      'Content-type': 'application/json;charset=UTF-8',
      Authorization: `Basic ${btoa(`${user}:${appId}`)}`,
    },
  })
    .then((response) => {
      // export the vtt to the podlove publisher
      if (response.status === 200) {
        const podloveUrlTranscript =
          url + '/wp-json/podlove/v2/transcripts/' + episodeId.toString();
        const podloveData = {
          type: 'vtt',
          content: text,
        };
        fetch(podloveUrlTranscript, {
          method: 'POST',
          body: JSON.stringify(podloveData),
          headers: {
            'Content-type': 'application/json;charset=UTF-8',
            Authorization: `Basic ${btoa(`${user}:${appId}`)}`,
          },
        })
          .then((response) => response.json())
          .catch((err) => console.error(err));
      }
    })
    .catch((err) => console.error(err));
}

export function checkIsPodloveExportPossible(
  episodeId: number,
  user: string,
  appId: string,
  url: string,
  setIsPodloveUploadPossible: (v: boolean) => void,
) {
  if (url.length < 1 || appId.length < 1 || user.length < 1 || episodeId < 1) {
    setIsPodloveUploadPossible(false);
  }

  const podloveUrlEpispde = url + '/wp-json/podlove/v2/episodes/' + episodeId.toString();
  fetch(podloveUrlEpispde, {
    method: 'GET',
  })
    .then((response) => {
      // export the vtt to the podlove publisher
      if (response.status === 200) {
        setIsPodloveUploadPossible(true);
      } else {
        if (response.status === 401) {
          fetch(podloveUrlEpispde, {
            method: 'GET',
            headers: {
              'Content-type': 'application/json;charset=UTF-8',
              Authorization: `Basic ${btoa(`${user}:${appId}`)}`,
            },
          })
            .then((response) => {
              if (response.status === 200) {
                setIsPodloveUploadPossible(true);
              } else {
                if (response.status === 401) {
                  setIsPodloveUploadPossible(false);
                }
                if (response.status === 404) {
                  setIsPodloveUploadPossible(false);
                }
                setIsPodloveUploadPossible(false);
              }
            })
            .catch((err) => {
              console.error(err);
              setIsPodloveUploadPossible(false);
            });
        }
        if (response.status === 404) {
          setIsPodloveUploadPossible(false);
        }
        setIsPodloveUploadPossible(false);
      }
    })
    .catch((err) => {
      console.error(err);
      setIsPodloveUploadPossible(false);
    });
}
