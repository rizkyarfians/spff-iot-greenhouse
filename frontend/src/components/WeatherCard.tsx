import { CloudSun, MapPin } from 'lucide-react';
import type { Weather } from '../types';
import { formatDate } from '../utils/format';

export function WeatherCard({ weather }: { weather: Weather }) {
  return <section className="card weather-card" aria-labelledby="weather-title"><div className="weather-top"><h2 id="weather-title"><MapPin size={19} />{weather.location}</h2><time dateTime={weather.date}>{formatDate(weather.date)}</time></div><div className="weather-reading"><strong>{weather.temperature}<sup>°</sup><small>C</small></strong><div><CloudSun /><span>{weather.condition}</span></div></div></section>;
}
