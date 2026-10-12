import { format, parseISO } from 'date-fns';

export const formatDateTime = (date: string | Date, pattern: string = 'PPpp'): string => {
  if (!date) return '';
  const parsed = typeof date === 'string' ? parseISO(date) : date;
  return format(parsed, pattern);
};
