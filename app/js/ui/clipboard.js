// Shared clipboard behavior for LAN HTTP and secure contexts.
export async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text; area.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px';
  const focused = document.activeElement;
  document.body.appendChild(area);
  try {
    area.focus(); area.select(); area.setSelectionRange(0, area.value.length);
    if (!document.execCommand('copy')) throw new Error('clipboard unavailable');
  } finally { area.remove(); focused?.focus({preventScroll:true}); }
}
