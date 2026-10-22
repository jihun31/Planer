const cacheKey = 'planer:ui-text-edits:v1';
const empty = () => ({version:1,sections:{}});
const api = () => window.electronAPI;
export async function readUiCopy() {
  if (api()?.readUiText) {
    const result = await api().readUiText();
    if (!result.ok) throw new Error('수정 문구 파일을 읽지 못했습니다. 파일을 확인한 뒤 다시 열어 주세요.');
    return result;
  }
  if (api()) throw new Error('앱을 완전히 종료한 뒤 다시 실행하면 문구 편집을 사용할 수 있습니다.');
  let data = empty();
  try {data = JSON.parse(window.localStorage.getItem(cacheKey)) || data;} catch { /* Use source defaults. */ }
  return {data,path:'브라우저 다운로드 폴더 · planer-ui-text-edits.json'};
}
export async function saveUiCopy(section,items) {
  if (api()?.saveUiText) {
    const result = await api().saveUiText(section,items);
    if (!result.ok) throw new Error('로컬 파일에 저장하지 못했습니다. 저장 위치의 접근 권한을 확인해 주세요.');
    return result;
  }
  if (api()) throw new Error('앱을 완전히 종료한 뒤 다시 실행해 주세요.');
  const {data} = await readUiCopy();
  data.sections[section] = {sourceFile:section === 'settings' ? 'src/components/ScheduleSettings.jsx' : 'src/components/HelpDialog.jsx',items};
  data.catalogFile = 'src/features/copy/uiCopy.mjs';
  data.updatedAt = new Date().toISOString();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2) + '\n'],{type:'application/json'}));
  const link = document.createElement('a');link.href = url;link.download = 'planer-ui-text-edits.json';link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  try {window.localStorage.setItem(cacheKey,JSON.stringify(data));} catch { /* Download still contains the saved edits. */ }
  return {data,path:'브라우저 다운로드 폴더 · planer-ui-text-edits.json'};
}
