import { LightningElement, api } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import { updateRecord, getRecordNotifyChange } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import QR_LIB from '@salesforce/resourceUrl/de_qrcodeGenerator';
import QR_FIELD from '@salesforce/schema/Lead.de_QR_Code__c';

// Encodes the Record Id (per the Service 360 scan flow, which prefix-routes
// 00Q/003/001). The de_qrcodeGenerator static resource exposes window.qrcode.
export default class De_recordQrCode extends LightningElement {
    @api recordId;
    @api cardTitle = 'Record QR Code';
    @api autoSave = false;

    qrDataUrl;
    error;
    saving = false;
    _libLoaded = false;

    renderedCallback() {
        if (this._libLoaded) {
            return;
        }
        this._libLoaded = true;
        loadScript(this, QR_LIB)
            .then(() => this.generate())
            .catch((e) => {
                this.error = 'Could not load the QR library: ' + this.reason(e);
            });
    }

    generate() {
        if (!this.recordId) {
            this.error = 'No record Id available.';
            return;
        }
        try {
            // typeNumber 0 = auto-fit; 'M' = ~15% error correction (good for print).
            const qr = window.qrcode(0, 'M');
            qr.addData(this.recordId);
            qr.make();
            // createDataURL(cellSize, margin) -> compact GIF data URI.
            this.qrDataUrl = qr.createDataURL(6, 8);
            this.error = undefined;
            if (this.autoSave) {
                this.saveToRecord();
            }
        } catch (e) {
            this.error = 'Could not generate the QR code: ' + this.reason(e);
        }
    }

    handleSave() {
        this.saveToRecord();
    }

    saveToRecord() {
        if (!this.qrDataUrl) {
            return;
        }
        this.saving = true;
        const html =
            '<img src="' +
            this.qrDataUrl +
            '" alt="QR code for ' +
            this.recordId +
            '" width="150" height="150" />';
        const fields = { Id: this.recordId };
        fields[QR_FIELD.fieldApiName] = html;
        updateRecord({ fields })
            .then(() => {
                getRecordNotifyChange([{ recordId: this.recordId }]);
                this.toast('Saved', 'QR code saved to this record.', 'success');
            })
            .catch((e) => {
                this.toast('Could not save', this.reason(e), 'error');
            })
            .finally(() => {
                this.saving = false;
            });
    }

    reason(e) {
        return (e && e.body && e.body.message) || (e && e.message) || 'Unknown error';
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    get hasQr() {
        return !!this.qrDataUrl && !this.error;
    }
}
