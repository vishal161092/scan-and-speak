import Scanner from './Scanner';

export default function Home() {
  return (
    <>
      <div className="topbar">
        <div className="logo">M</div>
        <div>
          <h1>Velo Service 360</h1>
          <div className="sub">Scan customer to begin</div>
        </div>
      </div>
      <div className="scan-wrap">
        <div className="scan-title">Scan Customer Barcode</div>
        <p className="scan-desc">Point the camera at the customer’s QR / barcode to load their Customer 360.</p>
        <Scanner />
      </div>
    </>
  );
}
