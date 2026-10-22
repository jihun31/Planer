const fs = require('node:fs/promises');
const path = require('node:path');

const sources = {settings:'src/components/ScheduleSettings.jsx',guide:'src/components/HelpDialog.jsx'};
function validItems(items) {
  return items && typeof items === 'object' && !Array.isArray(items) && Object.keys(items).length <= 100
    && Object.entries(items).every(([key,value]) => /^[a-zA-Z][a-zA-Z0-9.-]{0,79}$/.test(key)
      && value && typeof value === 'object' && typeof value.original === 'string' && value.original.length <= 5000
      && typeof value.text === 'string' && value.text.length <= 5000);
}

function createUiTextStore(filePath) {
  let queue = Promise.resolve();
  async function read() {
    let data;
    try {data = JSON.parse(await fs.readFile(filePath,'utf8'));}
    catch (error) {if (error.code === 'ENOENT') return {version:1,sections:{}};throw error;}
    if (data.version !== 1 || !data.sections || typeof data.sections !== 'object' || Array.isArray(data.sections)
      || !Object.entries(data.sections).every(([section,value]) => Object.hasOwn(sources,section) && validItems(value?.items))) {
      throw new Error('Invalid text edit file');
    }
    return data;
  }
  return {
    read:async () => {await queue;return read();},
    save(section,items) {
      if (!Object.hasOwn(sources,section) || !validItems(items)) return Promise.reject(new Error('Invalid text edits'));
      const operation = queue.then(async () => {
        const data = await read();
        data.sections[section] = {sourceFile:sources[section],items};
        data.catalogFile = 'src/features/copy/uiCopy.mjs';
        data.updatedAt = new Date().toISOString();
        await fs.mkdir(path.dirname(filePath),{recursive:true});
        const temporary = filePath + '.tmp';
        await fs.writeFile(temporary,JSON.stringify(data,null,2) + '\n','utf8');
        await fs.rename(temporary,filePath);
        return data;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
module.exports = {createUiTextStore};
