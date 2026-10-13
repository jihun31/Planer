export const isControlBlock = block => block.kind === 'control';
export const isStudyBlock = block => !isControlBlock(block);
