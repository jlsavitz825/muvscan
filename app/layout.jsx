import './globals.css';

export const metadata = {
  title: 'MÜV Vision Scanner',
  description: 'AI room-to-inventory scanner for MÜV moving estimates'
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
