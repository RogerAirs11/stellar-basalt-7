#!/bin/bash
# z-ai image-search for breed portraits + disciplines (real photos from the web)
mkdir -p scripts/gen-tmp/t33-search
declare -A Q=(
  [q1]="Kurdish horse portrait Iran"
  [q2]="Caspian horse pony portrait"
  [q3]="Turkmen horse Akhal-Teke type Iran"
  [q4]="Arabian horse stallion portrait head"
  [q5]="show jumping horse competition photo"
  [q6]="dressage horse competition Iran"
  [q7]="endurance horse racing desert"
  [q8]="chogan polo horse Iran play"
  [q9]="Iranian horse festival show"
  [q10]="Thoroughbred racehorse in training gallop"
  [q11]="horse racing finish line photo"
  [q12]="Persian Arabian horse show halter"
)
for k in "${!Q[@]}"; do
  z-ai image-search -q "${Q[$k]}" -n 15 -o "scripts/gen-tmp/t33-search/$k.json" 2>/dev/null || echo "fail $k"
done
ls -la scripts/gen-tmp/t33-search/
