const dateTime = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const time = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false });
const date = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
export const formatDateTime = (value: string) => `${dateTime.format(new Date(value))} WIB`;
export const formatTime = (value: string) => `${time.format(new Date(value)).replace('.', ':')} WIB`;
export const formatDate = (value: string) => date.format(new Date(value));
