export const downloadFile = async (url: string): Promise<void> => {
  try {
    const link = document.createElement('a');
    link.href = `/api/download?url=${encodeURIComponent(url)}`;
    link.download = url.split('/').pop() || 'download';
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Download failed:', error);
    window.open(url, '_blank');
  }
};
