export function downloadTextAsFile(filename: string, mime_type: string, text: string) {
  const elem = document.createElement('a');
  elem.setAttribute('href', 'data:' + mime_type + ';charset=utf-8,' + encodeURIComponent(text));
  elem.setAttribute('download', filename);
  elem.style.display = 'none';
  document.body.appendChild(elem);
  elem.click();
  document.body.removeChild(elem);
}
