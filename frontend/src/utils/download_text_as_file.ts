// stolen & adapted from https://stackoverflow.com/questions/25354313/saving-a-uint8array-to-a-binary-file

function downloadURL(data: string, fileName: string) {
  const a = document.createElement('a');
  a.href = data;
  a.download = fileName;
  document.body.appendChild(a);
  a.style.display = 'none';
  a.click();
  a.remove();
}

export function downloadBinaryAsFile(fileName: string, mimeType: string, data: Uint8Array) {
  const blob = new Blob([data], {
    type: mimeType,
  });

  const url = window.URL.createObjectURL(blob);
  downloadURL(url, fileName);

  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export function downloadTextAsFile(fileName: string, mimeType: string, text: string) {
  downloadURL('data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(text), fileName);
}
