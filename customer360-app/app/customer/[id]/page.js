import Customer360Client from './Customer360Client';

export default function CustomerPage({ params }) {
  return <Customer360Client id={params.id} />;
}
