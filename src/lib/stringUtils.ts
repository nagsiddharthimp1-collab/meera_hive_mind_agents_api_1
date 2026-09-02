export const truncateFileName = (fileName: string, maxLength: number = 20): string => {
  if (fileName.length <= maxLength) return fileName;
  const extension = fileName.lastIndexOf('.') !== -1 ? fileName.slice(fileName.lastIndexOf('.')) : '';
  const nameWithoutExt = fileName.slice(0, fileName.length - extension.length);
  const halfLength = Math.floor((maxLength - extension.length - 3) / 2);
  if (halfLength <= 0) return fileName.slice(0, maxLength - 3) + '...';
  return (
    nameWithoutExt.slice(0, halfLength) + '...' + nameWithoutExt.slice(nameWithoutExt.length - halfLength) + extension
  );
};
