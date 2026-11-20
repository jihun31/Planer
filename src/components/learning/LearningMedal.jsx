import bronze from '../../assets/learning-medals/flatshadow_medal2.png';
import silver from '../../assets/learning-medals/flatshadow_medal3.png';
import gold from '../../assets/learning-medals/flatshadow_medal8.png';
import navy from '../../assets/learning-medals/medal-navy-diamond-v2.webp';
import champagne from '../../assets/learning-medals/medal-champagne-flame-v2.webp';
import emerald from '../../assets/learning-medals/medal-emerald-sun-v2.webp';
import platinum from '../../assets/learning-medals/medal-platinum-compass.webp';
import legend from '../../assets/learning-medals/flatshadow_medal1.png';

const images = { bronze, silver, gold, navy, champagne, emerald, platinum, legend };

export default function LearningMedal({ tier }) {
  return <img className="learning-medal" src={images[tier]} alt="" aria-hidden="true" />;
}
