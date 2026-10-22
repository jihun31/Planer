import bronze from '../../assets/learning-medals/flatshadow_medal2.png';
import silver from '../../assets/learning-medals/flatshadow_medal3.png';
import gold from '../../assets/learning-medals/flatshadow_medal8.png';
import navy from '../../assets/learning-medals/medal-navy-diamond-v2.png';
import champagne from '../../assets/learning-medals/medal-champagne-flame-v2.png';
import rose from '../../assets/learning-medals/medal-emerald-sun-v2.png';
import platinum from '../../assets/learning-medals/medal-platinum-compass.png';
import legend from '../../assets/learning-medals/flatshadow_medal1.png';

const images = { bronze, silver, gold, navy, champagne, rose, platinum, legend };
// Frame the painted medal instead of the generated PNG's transparent padding.
const frames = {
  navy:'349 125 556 1041', champagne:'287 75 683 1120',
  rose:'313 75 628 1116', platinum:'287 74 684 1124',
};

export default function LearningMedal({ tier }) {
  return frames[tier]
    ? <svg className="learning-medal" viewBox={frames[tier]} aria-hidden="true" focusable="false">
      <image href={images[tier]} width="1254" height="1254" />
    </svg>
    : <img className="learning-medal" src={images[tier]} alt="" aria-hidden="true" />;
}
