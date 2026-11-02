import './globals.css';

export const metadata = {
  title: 'Velo Service 360',
  description: 'Scan a customer, load their 360, record & get live nudges.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0a0a0b',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app">{children}</div>
      </body>
    </html>
  );
}
