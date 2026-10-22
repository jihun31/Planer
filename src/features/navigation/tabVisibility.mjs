export function readTabVisibility(value) {
  try {
    const data = JSON.parse(value);
    return {control:data?.control !== false,calendar:data?.calendar !== false,notes:data?.notes !== false};
  } catch { return {control:true,calendar:true,notes:true}; }
}

export const visibleAppTabs = (tabs,visibility) => tabs.filter(tab =>
  !['control','calendar','notes'].includes(tab.id) || visibility[tab.id] !== false);
