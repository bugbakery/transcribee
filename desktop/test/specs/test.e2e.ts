import {setupBrowser} from '@testing-library/webdriverio'
import { expect, $ } from '@wdio/globals'

describe('My Login application', () => {
    it('should login with valid credentials', async () => {
      const { getByText, getByLabelText } = setupBrowser(browser);
        // await browser.url(`https://the-internet.herokuapp.com/login`)

        // await $('#username').setValue('tomsmith')
        // await $('#password').setValue('SuperSecretPassword!')
        // getByText()

        const button = await getByLabelText("Ok");
        await button.click();
        // await $('button[type="submit"]').click()

        // await expect($('#flash')).toBeExisting()
        // await expect($('#flash')).toHaveText(
        //     expect.stringContaining('You logged into a secure area!'))
    })
})
