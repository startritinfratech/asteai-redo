'use client';

import { publicFormsApi } from './api';
import { TokenAction } from './TokenAction';

export function ConfirmNewsletter() {
  return (
    <TokenAction
      action="Confirm that you want to receive the ASTEAI newsletter."
      cta="Confirm subscription"
      done={{ title: 'You’re subscribed', body: 'Thanks! Every newsletter includes a one-click unsubscribe link.' }}
      run={publicFormsApi.confirm}
    />
  );
}

export function Unsubscribe() {
  return (
    <TokenAction
      action="Stop receiving the ASTEAI newsletter at this address. Account and security emails are not affected."
      cta="Unsubscribe"
      done={{ title: 'You’ve been unsubscribed', body: 'You won’t receive the newsletter any more. You can sign up again from any page footer.' }}
      run={publicFormsApi.unsubscribe}
    />
  );
}
