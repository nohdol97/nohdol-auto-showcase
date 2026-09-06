import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewAnalysisRequest, validateReviewAnalysis } from '../src/radar-review-analysis.mjs';

const url = 'https://www.daangn.com/kr/local-profile/sample-demo123/';
const evidence = {
  provider: 'daangn', url, fetchedAt: '2026-09-06T00:00:00.000Z', coverage: 'initial_page',
  customerReviewCount: 2, ownerReplyCount: 1, reportedReviewCount: 20,
  observations: [
    { id: 'review-1', kind: 'customer_review', text: '수업 내용을 다시 확인하고 싶어요.', publishedAt: '2026-09-01' },
    { id: 'review-2', kind: 'customer_review', text: '차근차근 알려줘서 좋았습니다.', publishedAt: null },
    { id: 'reply-1', kind: 'owner_reply', text: '다음 시간에 함께 확인하겠습니다.', publishedAt: null },
  ],
};
function analysis() {
  return {
    confirmedFacts: [], painHypothesis: '수업 기록 전달 방식에 개선 여지가 있는지 확인해야 합니다.', confidence: 90,
    sources: [{kind:'daangn_profile',url,title:'가상 레슨실 후기',summary:'초기 공개 페이지의 고객 경험과 답글을 구분했습니다.'}],
    suggestedTool:'복습 카드',openingQuestion:'수업 내용을 어떻게 전달하시나요?',doNotClaim:'기록 업무가 불편하거나 구매 의사가 있다고 확인된 것은 아닙니다.',
    prototypeOffer:{name:'복습 카드',promise:'수업 내용을 정리합니다.',demoScope:'가상 레슨 기록과 카드 출력',requiredInput:'가상 교정 항목',proofOfValue:'정리 시간을 비교합니다.'},
    reviewInsights:{
      signals:[{evidenceId:'review-1',kind:'customer_review',summary:'한 고객이 복습할 내용을 다시 확인하고 싶다고 표현했습니다.'},{evidenceId:'reply-1',kind:'owner_reply',summary:'업체가 다음 수업에서 확인하겠다고 답했습니다.'}],
      items:[{name:'복습 카드',evidenceIds:['review-1','reply-1'],hypothesis:'복습 자료 전달에 도움이 될 가능성을 확인합니다.',firstQuestion:'수업 내용을 어떻게 전달하시나요?',demoScope:'가상 수업 1건을 카드로 출력',validationMetric:'카드 작성 소요 시간'}],
      limitation:'초기 페이지 일부 후기이며 업무 불편이나 구매 수요는 미확인입니다.',
    },
  };
}

test('[REG:radar.review_items] a collected review request separates customer claims and owner replies without further web collection', () => {
  const request = buildReviewAnalysisRequest({model:'gpt-test',place:{name:'가상 레슨실',address:'가상로 1',category:'골프'},evidence});
  assert.equal(request.store,false);
  assert.equal(request.model,'gpt-test');
  assert.deepEqual(request.tools,[]);
  assert.match(request.input,/review-1/);
  assert.match(request.input,/owner_reply/);
  assert.match(request.instructions,/구매/);
  assert.match(request.instructions,/신뢰할 수 없는/);
  assert.ok(request.text.format.schema.required.includes('reviewInsights'));
});

test('[REG:radar.review_items] verified signals cap confidence and persist summaries with server-owned coverage, not raw input', () => {
  const value = analysis();
  value.reviewEvidence={customerReviewCount:999};
  value.untrustedExtra='not stored';
  const result = validateReviewAnalysis(value,evidence);
  assert.equal(result.confidence,60);
  assert.equal(result.reviewEvidence.customerReviewCount,2);
  assert.equal(result.reviewEvidence.reportedReviewCount,20);
  assert.equal(result.reviewEvidence.coverage,'initial_page');
  assert.equal(result.reviewInsights.items.length,1);
  assert.equal(Object.hasOwn(result.reviewEvidence,'observations'),false);
  assert.equal(Object.hasOwn(result,'untrustedExtra'),false);
  assert.doesNotMatch(JSON.stringify(result),/수업 내용을 다시 확인하고 싶어요/);
  assert.equal(validateReviewAnalysis(analysis(),{...evidence,customerReviewCount:1}).confidence,30);
});

test('[REG:radar.review_items] nonexistent evidence, role laundering and uncollected source URLs are rejected', () => {
  const mutate = (change) => {const value=analysis();change(value);return value;};
  for(const value of [
    mutate(v=>v.reviewInsights.signals[0].evidenceId='invented'),
    mutate(v=>v.reviewInsights.signals[0].kind='owner_reply'),
    mutate(v=>v.reviewInsights.items[0].evidenceIds=['invented']),
    mutate(v=>v.reviewInsights.items[0].evidenceIds=['reply-1']),
    mutate(v=>v.sources[0].url='https://www.daangn.com/kr/local-profile/other-other123/'),
    mutate(v=>v.reviewInsights.items=[]),
    mutate(v=>v.reviewInsights.items[0].validationMetric=''),
  ]) assert.throws(()=>validateReviewAnalysis(value,evidence));
  assert.throws(()=>validateReviewAnalysis(analysis(),{...evidence,customerReviewCount:0}));
});

test('[REG:radar.review_items] copied source passages are rejected across persisted fields',()=>{
  const original='합성 고객이 작성한 긴 후기 원문이며 수업 이후 안내받은 연습 내용을 집에서 다시 확인하고 싶은 경험을 상세하게 설명합니다.';
  const collected={...evidence,observations:[{...evidence.observations[0],text:original},...evidence.observations.slice(1)]};
  for(const assign of [
    value=>value.reviewInsights.signals[0].summary=original,
    value=>value.prototypeOffer.promise=original,
    value=>value.reviewInsights.items[0].hypothesis='고객 의견: '+original.slice(0,45),
  ]) {
    const value=analysis();assign(value);
    assert.throws(()=>validateReviewAnalysis(value,collected),/verbatim/);
  }
  assert.equal(validateReviewAnalysis(analysis(),collected).reviewInsights.items.length,1);
});
