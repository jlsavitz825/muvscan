import './globals.css';

export const metadata = {
  title: 'MüvScan',
  description: 'AI moving inventory scanner for MÜV'
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
