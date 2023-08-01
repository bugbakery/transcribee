export function downloadTextAsFile(filename: string, mime_type: string, text: string) {
  const elem = document.createElement('a');
  elem.setAttribute('href', 'data:' + mime_type + ';charset=utf-8,' + encodeURIComponent(text));
  elem.setAttribute('download', filename);
  elem.style.display = 'none';
  document.body.appendChild(elem);
  elem.click();
  document.body.removeChild(elem);
}

export function downloadBinaryAsFile(filename: string, mime_type: string, bytes: Uint8Array) {
  const elem = document.createElement('a');
  const text = Array.from(bytes, (x) => String.fromCodePoint(x)).join('');
  elem.setAttribute('href', 'data:' + mime_type + ';base64,' + btoa(text));
  elem.setAttribute('download', filename);
  elem.style.display = 'none';
  document.body.appendChild(elem);
  elem.click();
  document.body.removeChild(elem);
}
